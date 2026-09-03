import { createAnthropic } from "@ai-sdk/anthropic";
import { Think } from "@cloudflare/think";
import { callable, getAgentByName } from "agents";
import type { AgentMcpOAuthProvider } from "agents/mcp/do-oauth-client-provider";
import { hasToolCall, tool, type UIMessage } from "ai";
import { z } from "zod";
import {
  GCAL_CALLBACK_PATH,
  GCAL_MCP_URL,
  GoogleOAuthProvider,
  type GcalTokenStore,
} from "./gcal";
import {
  COVERED_BY_JUNCTION,
  DEFAULT_ENGINE_BASE,
  PI_APPS,
  toolOwner,
  type AppKey,
  type PiApp,
  type PiSettings,
} from "../shared/apps";

export type PiState = {
  settings: PiSettings | null;
  /** Per-app connection errors from the last reconcile, for the UI. */
  appErrors: Partial<Record<AppKey, string>>;
  /** OAuth consent URLs awaiting the user (e.g. Google Calendar). */
  authUrls?: Partial<Record<AppKey, string>>;
  /** Whether the desk holds Google tokens (chats can use the calendar). */
  gcalReady?: boolean;
  /**
   * Set when a turn started without its TigerApps — the answer is running on
   * the model alone, and the interface should say so rather than let PI look
   * like it simply forgot the student's courses. Cleared by the next
   * successful settings push.
   */
  connectError?: string;
};

const CLAUDE_MODELS = new Set(["claude-opus-5", "claude-sonnet-5"]);
const DEFAULT_CLAUDE_MODEL = "claude-opus-5";

/** The apps PI may ask a student to switch on. */
const APP_KEYS = PI_APPS.map((a) => a.key) as [AppKey, ...AppKey[]];

/**
 * The two tools that hand the turn back to the student. Neither does any
 * work: the interface draws the tool call itself — option rows, a consent
 * card — and whatever the student taps arrives as their next message. They
 * are merged in beforeTurn rather than declared in getTools() so they land
 * after the MCP toolset, where no app server can shadow their names.
 */
const ELICITATION_TOOLS = {
  offer_choices: tool({
    description:
      "Ask the student to pick from a short list of next steps or preferences. Use this instead of writing a numbered menu in your reply. The interface draws the options and their answer comes back as their next message, so end your turn right after calling this.",
    inputSchema: z.object({
      question: z
        .string()
        .describe("The question as you'd say it out loud — one short line."),
      options: z
        .array(
          z.object({
            label: z
              .string()
              .describe("What the student is choosing, a few words."),
            detail: z
              .string()
              .optional()
              .describe(
                "One short line on what this option means or costs. Leave it out if the label says everything."
              ),
          })
        )
        // A bound, not just prose: an empty array would end the turn (see
        // stopWhen) on a question the interface has nothing to draw.
        .min(2)
        .max(5)
        .describe("Two to five options, in the order you'd recommend them."),
      multi: z
        .boolean()
        .describe("True when more than one option can be picked."),
      allowOther: z
        .boolean()
        .describe(
          "True when a typed answer of their own makes sense alongside the options."
        ),
    }),
    execute: async () =>
      "Choices shown to the student. Their selection arrives as their next message. Do not answer for them — end your turn after any brief framing.",
  }),
  request_app: tool({
    description:
      "Ask the student to switch on an app you aren't connected to yet, with a concrete reason. Use this instead of telling them to go to the My apps page. The interface draws a card they can accept or decline, so end your turn right after calling this.",
    inputSchema: z.object({
      app: z.enum(APP_KEYS).describe("Which app you need."),
      reason: z
        .string()
        .describe(
          "One line on what switching it on would let you do for them right now."
        ),
    }),
    execute: async ({ app }) => {
      if (!PI_APPS.some((a) => a.key === app)) {
        return `There's no app called "${app}". You can ask for: ${APP_KEYS.join(", ")}.`;
      }
      return `Consent card shown for ${app}. The student will decide; end your turn after a brief line — do not assume it was granted.`;
    },
  }),
};

/**
 * Split an AI SDK tool key back into the app whose connection served it and
 * the bare MCP tool name. The MCP manager builds these keys as
 * `tool_<server id, dashes stripped>_<tool name>`, and the client's
 * parseToolPart (client/lib/tools.ts) takes them apart the same way — the two
 * must stay in step, because they answer the same question on either end.
 */
function splitToolKey(key: string): { app: AppKey | null; base: string } {
  const m = key.match(/^tool_([a-z0-9]+)_(.+)$/);
  if (!m) return { app: null, base: key };
  const app = PI_APPS.find((a) => a.key.replace(/-/g, "") === m[1])?.key ?? null;
  return { app, base: m[2] };
}

/**
 * A student's app toggles are consent, not routing. One connection can hand
 * over another app's data — the engine's junction scope registers
 * TigerSnatch's seat-watch tools and TigerPath's requirement tools — so
 * "which server answered" is the wrong question to gate on. Ask who the data
 * belongs to (TOOL_OWNERS, and the hints under it) and drop the tool when that
 * app is switched off, before the model can see it and reach for it.
 *
 * Two ways a tool can go unplaced, and they're treated differently. PI's own
 * file tools aren't namespaced at all — nobody's app data, so they pass
 * through. A namespaced tool whose server isn't one of ours can only have
 * come over a connection PI opened, and there's no honest way to say whose
 * data it carries, so it's withheld rather than waved through.
 */
function dropUnconsentedTools<T>(
  tools: Record<string, T>,
  enabled: Set<AppKey>
): Record<string, T> {
  const kept: Record<string, T> = {};
  const dropped: string[] = [];
  const unplaceable: string[] = [];
  for (const [key, value] of Object.entries(tools)) {
    if (!key.startsWith("tool_")) {
      kept[key] = value;
      continue;
    }
    const { app, base } = splitToolKey(key);
    if (!app) {
      unplaceable.push(key);
      continue;
    }
    const owner = toolOwner(base, app);
    if (owner && !enabled.has(owner)) {
      dropped.push(key);
      continue;
    }
    kept[key] = value;
  }
  if (dropped.length > 0) {
    console.log(
      `consent: withheld ${dropped.length} tool(s):`,
      dropped.join(", ")
    );
  }
  if (unplaceable.length > 0) {
    console.warn(
      `consent: ${unplaceable.length} tool(s) from an unknown server, withheld:`,
      unplaceable.join(", ")
    );
  }
  return kept;
}

/** "TigerJunction", "TigerJunction and TigerPath", "a, b and c". */
function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Tells the model an app the prompt claims it has isn't there this turn. */
function missingAppsNote(names: string[]): string {
  const many = names.length > 1;
  return `${nameList(names)} ${many ? "are" : "is"} switched on but didn't connect for this turn, so none of ${many ? "their" : "its"} tools are in front of you. If the question needs ${many ? "them" : "it"}, say plainly that you can't see that right now — never answer it from memory instead.`;
}

/**
 * PI — a lightweight Princeton chat agent. One Durable Object instance per
 * conversation. Princeton data arrives through the junction engine's scoped
 * MCP endpoints, spoken over MCP v2 stateless streamable HTTP.
 */
export class Pi extends Think<Env, PiState> {
  initialState: PiState = {
    settings: null,
    appErrors: {},
    authUrls: {},
    gcalReady: false,
  };

  /** Pure chat agent — no shell tool. Workspace file tools stay available. */
  workspaceBash = false;
  waitForMcpConnections = { timeout: 15_000 };
  maxSteps = 12;
  /**
   * Abort-and-recover a model stream that parks without erroring — the
   * cause of "spinning forever" turns. Set well above the slowest
   * time-to-first-token plus the slowest MCP tool call.
   */
  chatStreamStallTimeoutMs = 120_000;

  getDefaultTimezone() {
    return "America/New_York";
  }

  getModel() {
    const settings = this.getConfig<PiSettings>();
    const preference = settings?.model ?? DEFAULT_CLAUDE_MODEL;
    const key = this.env.ANTHROPIC_API_KEY;
    if (!key) {
      // No silent fallback model: fail the turn loudly so ops notices.
      throw new Error("ANTHROPIC_API_KEY is not configured");
    }
    // Stale configs may still carry the retired "campus" preference.
    const model = CLAUDE_MODELS.has(preference)
      ? preference
      : DEFAULT_CLAUDE_MODEL;
    return createAnthropic({ apiKey: key })(model);
  }

  getSystemPrompt() {
    const settings = this.getConfig<PiSettings>();
    const today = new Date().toLocaleDateString("en-CA", {
      timeZone: "America/New_York",
    });
    const enabled = new Set<AppKey>(settings?.apps ?? []);
    const connected = PI_APPS.filter((a) => enabled.has(a.key));
    // Whether these apps actually answered isn't known yet: this prompt is
    // assembled before beforeTurn opens the connections, so an app that turns
    // out to be down is corrected there (see missingAppsNote).
    // Every switched-off app is worth asking for, including the ones junction
    // could technically answer for: their tools are withheld until the student
    // says yes (see dropUnconsentedTools), so the toggle is a real answer now,
    // not a duplicate of something they already have.
    const offerable = PI_APPS.filter((a) => !enabled.has(a.key));
    return [
      "You are PI, the TigerApps assistant for Princeton students — a quick, warm study-desk companion. Your answers should read like notes from a sharp friend: concise, concrete, no filler.",
      "",
      `Today's date: ${today} (America/New_York).`,
      settings?.netid
        ? `The student's netid is ${settings.netid}. Personal tools (schedules, degree progress, seat alerts) act on their behalf.`
        : "No netid is set. Catalog and evaluation tools work; personal tools (schedules, degree progress, alerts) will refuse until the student sets a netid on the My apps page.",
      "",
      connected.length > 0
        ? `Connected TigerApps: ${connected.map((a) => `${a.name} (${a.tagline.toLowerCase()})`).join(", ")}.`
        : "No TigerApps are connected, so you have no live Princeton data — don't answer course facts from memory.",
      offerable.length > 0
        ? `Switched off: ${offerable.map((a) => `${a.name} (key "${a.key}", ${a.tagline.toLowerCase()})`).join("; ")}. When one of these would answer the question, call request_app for it instead of working around it or sending the student off to a settings page.`
        : "",
      "",
      "Voice:",
      "- Lead with the answer. No preamble, no restating the question, no summary of what you just said.",
      "- Write like a student who knows the catalog: specific course codes, times and numbers instead of adjectives.",
      "- Sentence case. No exclamation marks, no emoji, no bold sprinkled for emphasis.",
      "- Never narrate your own machinery — no talk of tools, connections, servers or models. Say what you found, or what you can't see.",
      "- When you're unsure, say what you know and what you'd have to check.",
      "",
      "Asking the student instead of guessing:",
      "- offer_choices — when the next step turns on a preference you can enumerate (which term, which of three courses, mornings or afternoons), call offer_choices with the question and two to five options. Set multi when several answers can be true, allowOther when a typed answer makes sense. Write at most one line of framing, then end your turn: their pick arrives as their next message.",
      "- request_app — when the answer needs a TigerApp that's switched off, call request_app with its key and a concrete reason (\"TigerPath holds your requirement tree\"). End your turn after a short line, and don't assume they said yes.",
      "- Google Calendar also needs a one-time Google sign-in on the My apps page, so say that when you request it.",
      "- One of these per turn, and never write a menu of options out in prose — that's what offer_choices is for.",
      "",
      "Ground rules:",
      "- Princeton term codes end in 2 for Fall and 4 for Spring (e.g. 1272 = Fall 2026). When unsure which term is current, call list_terms rather than guessing.",
      "- The interface renders schedule, course, seat-demand, trending and past-term tool results as visual cards automatically. After a tool call, add a short takeaway (conflicts, standouts, whether a seat is realistic, next step) — never re-list every row the card already shows.",
      "- When a tool errors or comes back empty, say plainly what didn't work and offer the closest thing you can still do. Never paste raw error text, URLs or status codes at the student.",
      "- Confirm before anything that writes: adding or dropping a course, creating or editing a schedule, subscribing to a seat alert, deleting anything. Name exactly what you're about to change, then wait for a yes.",
      "- Keep answers tight. Prefer a short paragraph or a few bullets over headers and long lists; if a comparison really needs a table, keep it to three columns.",
      ...(enabled.has("gcal")
        ? [
            "- Google Calendar is connected read-only: use its tools for the student's real events and free/busy when planning around their week. You cannot modify their calendar.",
          ]
        : []),
      ...(enabled.has("snatch")
        ? [
            "",
            "Seat watches:",
            "- A watch is a real change to their account, so confirm first with offer_choices naming the exact course and section — question \"Watch COS 226 L01?\", options like \"watch it\" and \"not now\" — and wait for the pick. Same before dropping one.",
            "- A message that already names one exact course and section (\"Watch COS 226 L01.\", \"Stop watching COS 226 L01.\") IS that confirmation. Make the call; don't ask the same question back.",
            "- When a subscribe call comes back needing a section (a reply carrying needsSection, or an older-style error whose text lists the sections), the interface is already drawing those sections as a pick list. Say one short line — which one looks most gettable, if you can tell — and end your turn. Don't retype the sections in prose, and don't call offer_choices for them: the pick is already on screen.",
            "- Only say a watch is on when the tool actually answered subscribed: true, and only say one is off on unsubscribed: true. If the call failed, say what didn't take and leave it there.",
            "- When their subscriptions come back with a message about no TigerSnatch account, say plainly that seat watches need a TigerSnatch account and that they can start one at tigersnatch.com. Don't try to make one for them.",
            "- On demand and trending numbers, the count of students waiting is the story: say whether a seat looks likely and what you'd do about it, and let the card carry the per-section rows.",
          ]
        : []),
    ].join("\n");
  }

  /**
   * Push settings from the client, then reconcile MCP connections to match.
   * Identity travels as headers on each connection, so a netid change forces
   * a reconnect of every app.
   */
  @callable()
  async setup(settings: PiSettings, opts: { connect?: boolean } = {}) {
    // The Worker only routes a user to instances named `u-<netid>-…`, so
    // requiring the same prefix here pins the MCP identity headers to the
    // signed-in user — settings.netid can't be spoofed sideways.
    if (!this.name.startsWith(`u-${settings.netid}-`)) {
      throw new Error("identity mismatch: settings netid doesn't own this chat");
    }
    const prev = this.getConfig<PiSettings>();
    const identityChanged = prev != null && prev.netid !== settings.netid;
    this.configure<PiSettings>(settings);

    const appErrors: Partial<Record<AppKey, string>> = {};
    const authUrls: Partial<Record<AppKey, string>> = {};
    // Which endpoints to open — NOT which apps the student consented to.
    // Every COVERED_BY_JUNCTION scope is a strict subset of junction's, so
    // opening one alongside junction registers each shared tool twice (two
    // names for one call, and a model that picks whichever it saw last).
    // Junction wins; consent is enforced per tool instead, in beforeTurn and
    // callAppTool, so a covered app's toggle still means something.
    const enabled = new Set<AppKey>(settings.apps);
    if (enabled.has("junction")) {
      for (const covered of COVERED_BY_JUNCTION) enabled.delete(covered);
    }
    const base = this.engineBase();
    const expectedUrl = (app: (typeof PI_APPS)[number]) =>
      app.mcpUrl ?? `${base}${app.mcpPath}`;
    // Chats may only hold a Google connection while the desk has tokens —
    // this also evicts legacy connections made before token gating existed.
    const gcalEntitled =
      !enabled.has("gcal") || this.isDesk()
        ? true
        : await (await this.deskStub(settings.netid)).gcalTokensHas();

    // Land the user back on My apps after a Google consent round-trip.
    this.mcp.configureOAuthCallback({
      successRedirect: "/apps",
      errorRedirect: "/apps",
    });

    // `enabled` has already lost the junction-covered apps, so a connection
    // opened before junction was switched on is stale here and gets closed —
    // otherwise its duplicate tools would linger for the life of the object.
    for (const [id, server] of Object.entries(this.getMcpServers().servers)) {
      const app = PI_APPS.find((a) => a.key === id);
      const stale =
        !app ||
        !enabled.has(app.key) ||
        (identityChanged && app.key !== "gcal") ||
        (app.key === "gcal" && !gcalEntitled) ||
        server.server_url !== expectedUrl(app);
      if (stale) await this.removeMcpServer(id);
    }

    const connectedIds = new Set(Object.keys(this.getMcpServers().servers));
    for (const app of PI_APPS) {
      if (!enabled.has(app.key) || connectedIds.has(app.key)) continue;
      // Engine connections open right before a turn (see releaseIdleMcp for
      // why); in a plain settings push only the desk's Google consent flow
      // needs any connection work.
      if (!opts.connect && !(app.key === "gcal" && this.isDesk())) continue;
      try {
        if (app.key === "gcal") {
          if (
            !this.env.GOOGLE_OAUTH_CLIENT_ID ||
            !this.env.GOOGLE_OAUTH_CLIENT_SECRET
          ) {
            appErrors.gcal = "Google sign-in isn't configured on the server yet";
            continue;
          }
          // Consent happens once, on the desk (via My apps). Chats reuse the
          // desk's tokens; without them, don't start a doomed OAuth dance.
          if (!this.isDesk()) {
            const desk = await this.deskStub(settings.netid);
            if (!(await desk.gcalTokensHas())) {
              appErrors.gcal = "Connect Google Calendar from My apps first";
              continue;
            }
          }
          const result = await this.addMcpServer(app.name, GCAL_MCP_URL, {
            id: app.key,
            callbackHost: this.appOrigin(),
            callbackPath: GCAL_CALLBACK_PATH.slice(1),
            transport: { type: "streamable-http" },
          });
          if (result.state === "authenticating") {
            authUrls.gcal = result.authUrl;
          }
          continue;
        }
        await this.addMcpServer(app.name, expectedUrl(app), {
          id: app.key,
          transport: {
            type: "streamable-http",
            headers: this.engineHeaders(settings.netid),
          },
        });
      } catch (err) {
        appErrors[app.key] = this.connectFailure(app, err);
      }
    }

    // Google's MCP server answers initialize and tools/list anonymously, so
    // a tokenless connection lands "ready" without OAuth ever starting — the
    // 401 only appears on a real tool call. If the desk is connected but has
    // no tokens (fresh toggle OR a connection left over from an earlier
    // visit), force that call and surface the consent URL it produces.
    if (
      enabled.has("gcal") &&
      this.isDesk() &&
      !authUrls.gcal &&
      !appErrors.gcal &&
      this.env.GOOGLE_OAUTH_CLIENT_ID &&
      this.env.GOOGLE_OAUTH_CLIENT_SECRET &&
      this.getMcpServers().servers.gcal &&
      !(await this.gcalTokensHas())
    ) {
      const url = await this.forceGcalConsent();
      if (url) authUrls.gcal = url;
      else appErrors.gcal = "PI couldn't start the Google sign-in. Try again.";
    }

    const gcalReady = enabled.has("gcal")
      ? this.isDesk()
        ? await this.gcalTokensHas()
        : await (await this.deskStub(settings.netid)).gcalTokensHas()
      : false;

    // Nothing is about to run — don't sit on open connections.
    if (!opts.connect) await this.releaseIdleMcp();

    this.setState({ settings, appErrors, authUrls, gcalReady });
    return { ok: true as const, appErrors, authUrls, gcalReady };
  }

  /**
   * A failed connection is read by a student on their My apps card, so say
   * it in words they can act on. The transport's own text stays in the logs,
   * where it's useful.
   */
  private connectFailure(app: PiApp, err: unknown): string {
    const raw = err instanceof Error ? err.message : String(err);
    console.warn(`connect ${app.key} failed:`, raw);
    const text = raw.toLowerCase();
    const has = (...needles: string[]) => needles.some((n) => text.includes(n));
    if (has("timeout", "timed out", "abort")) {
      return `${app.name} took too long to answer. Try again in a minute.`;
    }
    if (has("401", "403", "unauthorized", "forbidden")) {
      return `${app.name} wouldn't let PI in. That one's on us, not you.`;
    }
    if (has("fetch failed", "network") || /\b5\d\d\b/.test(text)) {
      return `${app.name} is down right now. Try again later.`;
    }
    return `PI couldn't reach ${app.name}. Try again in a minute.`;
  }

  /**
   * A Durable Object holding live MCP connections never hibernates — it
   * stays resident (and billed) around the clock even with zero traffic,
   * while an identical object without them sleeps instantly. So PI keeps
   * connections only for the duration of work: opened just before a turn or
   * a direct tool call, released as soon as it ends, and swept on every
   * wake in case a previous isolate left some behind.
   */
  private async releaseIdleMcp(): Promise<void> {
    for (const [id, server] of Object.entries(this.getMcpServers().servers)) {
      // Keep a Google connection that's mid-consent; its OAuth state lives
      // on the connection row and the callback needs it.
      if (id === "gcal" && server.state === "authenticating") continue;
      try {
        await this.removeMcpServer(id);
      } catch (err) {
        console.warn(`release ${id} failed`, err);
      }
    }
  }

  /**
   * Open this turn's MCP connections on the server, so the client can fire
   * a message instantly instead of awaiting a connect round-trip first
   * (which both delayed the echo of sent messages and let quick successive
   * sends overtake each other). Think assembles its automatic MCP toolset
   * before this hook runs — while nothing is connected — so the freshly
   * connected tools are returned here to be merged into the turn, along
   * with the two tools PI uses to hand the turn back to the student.
   */
  override async beforeTurn(
    ctx: Parameters<Think["beforeTurn"]>[0]
  ): Promise<ReturnType<Think["beforeTurn"]> extends infer R ? Awaited<R> : never> {
    const inherited = await super.beforeTurn(ctx);
    const settings = this.getConfig<PiSettings>();
    if (!settings) return inherited ?? undefined;
    /** Apps the model was told it has, that this turn hasn't got. */
    let missing: string[] = [];
    try {
      const { appErrors } = await this.setup(settings, { connect: true });
      // setup() files a dead app server under appErrors instead of throwing,
      // so a turn can lose every course tool and still resolve here. Read what
      // it reported rather than trusting that it came back at all.
      const failed = new Set<AppKey>(
        PI_APPS.filter((a) => appErrors[a.key]).map((a) => a.key)
      );
      // Only the endpoints setup() actually opened can report an error, and the
      // junction connection is the one carrying the covered apps' tools. So
      // when it dies it takes their data with it, silently: without this, the
      // prompt still says "Connected TigerApps: … TigerSnatch" and the note
      // below names TigerJunction alone, which reads as "the rest are fine".
      if (failed.has("junction")) {
        for (const covered of COVERED_BY_JUNCTION) {
          if (settings.apps.includes(covered)) failed.add(covered);
        }
      }
      missing = PI_APPS.filter((a) => failed.has(a.key)).map((a) => a.name);
      const note =
        missing.length > 0
          ? `PI couldn’t use ${nameList(missing)} for this answer, so anything ${missing.length > 1 ? "they hold" : "it holds"} is missing.`
          : undefined;
      // A turn that did connect retires the last failure, so the interface
      // stops warning about data this answer actually has. Only written when
      // something changed — every setState reaches every client.
      if (note !== this.state?.connectError) {
        const { connectError: _prev, ...rest } = this.state;
        this.setState(note ? { ...rest, connectError: note } : rest);
      }
    } catch (err) {
      console.warn("beforeTurn connect failed", err);
      missing = PI_APPS.filter((a) => settings.apps.includes(a.key)).map(
        (a) => a.name
      );
      // The turn still runs, on the model alone. Leave a note in state so
      // the interface can say so instead of quietly serving a thinner answer.
      this.setState({
        ...this.state,
        connectError:
          "PI couldn’t reach your TigerApps, so this answer may be missing course data.",
      });
    }
    // One connection can carry several apps' data, so the merged toolset is
    // filtered by who each tool's data belongs to before the model sees it.
    // A student who switched TigerSnatch off gets no seat-watch tools, even
    // though the junction connection is sitting there offering them.
    const tools = dropUnconsentedTools(
      { ...(inherited?.tools ?? {}), ...this.mcp.getAITools() },
      new Set<AppKey>(settings.apps)
    );
    const inheritedStops = inherited?.stopWhen;
    const stops = Array.isArray(inheritedStops)
      ? inheritedStops
      : inheritedStops
        ? [inheritedStops]
        : [];
    return {
      ...(inherited ?? {}),
      // The system prompt is assembled before this hook runs, so a turn that
      // lost an app can only correct the record here — otherwise the model
      // reads "Connected TigerApps: TigerJunction" and answers with the
      // confidence that implies, on no data at all.
      ...(missing.length > 0
        ? {
            system: `${inherited?.system ?? ctx.system}\n\n${missingAppsNote(missing)}`,
          }
        : {}),
      // The elicitation tools go on last: an app server can register any
      // tool name it likes, and these two have to survive the merge — and
      // the consent filter, which is about app data they never touch.
      tools: { ...tools, ...ELICITATION_TOOLS },
      // Eliciting ends the turn — the student's answer is the next message,
      // so don't let the model talk past its own question.
      stopWhen: [
        ...stops,
        hasToolCall("offer_choices"),
        hasToolCall("request_app"),
      ],
    };
  }

  override async onStart(props?: Record<string, unknown>) {
    await super.onStart(props);
    await this.releaseIdleMcp();
  }

  override async onChatResponse(result: Parameters<Think["onChatResponse"]>[0]) {
    await super.onChatResponse(result);
    await this.releaseIdleMcp();
  }

  override async onChatError(error: unknown, ctx?: Parameters<Think["onChatError"]>[1]) {
    const out = await super.onChatError(error, ctx);
    await this.releaseIdleMcp();
    return out;
  }

  /**
   * Direct MCP tool call for non-chat surfaces (planner, agenda). Returns the
   * tool's JSON payload parsed from its text content.
   */
  @callable()
  async callAppTool(app: AppKey, name: string, args: Record<string, unknown>) {
    const settings = this.getConfig<PiSettings>();
    if (!settings?.apps.includes(app)) throw new Error(`${app} is switched off`);
    // The agenda reaches TigerSnatch's tools over the junction connection, so
    // an enabled server is not consent for the data it carries: the seat-watch
    // card must go quiet when TigerSnatch itself is switched off.
    const owner = toolOwner(name, app);
    if (owner && !settings.apps.includes(owner)) {
      const label = PI_APPS.find((a) => a.key === owner)?.name ?? owner;
      throw new Error(`${label} is switched off`);
    }
    if (!this.getMcpServers().servers[app]) {
      await this.setup(settings, { connect: true });
      if (!this.getMcpServers().servers[app]) {
        throw new Error(`${app} is not connected`);
      }
    }
    try {
      const result = (await this.mcp.callTool({
        serverId: app,
        name,
        arguments: args,
      })) as {
        isError?: boolean;
        content?: Array<{ type: string; text?: string }>;
      };
      const text =
        result.content?.find((c) => c.type === "text" && c.text)?.text ?? "";
      if (result.isError) throw new Error(text || `${name} failed`);
      try {
        return JSON.parse(text);
      } catch {
        return { text };
      }
    } finally {
      await this.releaseIdleMcp();
    }
  }

  /**
   * Seed this (fresh) conversation with history copied from another chat —
   * powers fork and rewind. Appends without running a model turn.
   */
  @callable()
  async importHistory(messages: UIMessage[]) {
    if (!Array.isArray(messages) || messages.length === 0) {
      return { ok: true as const, count: 0 };
    }
    await this.addMessages(messages);
    return { ok: true as const, count: messages.length };
  }

  /**
   * Kick Google's MCP server with a cheap authenticated-only call so the
   * transport's OAuth machinery runs (discovery, state, PKCE) and hands us
   * a consent URL. Returns null if calendar access unexpectedly works
   * already or no URL could be produced.
   */
  private async forceGcalConsent(): Promise<string | null> {
    try {
      await this.mcp.callTool({
        serverId: "gcal",
        name: "list_calendars",
        arguments: {},
      });
      return null; // already authorized somehow — nothing to do
    } catch {
      // Expected: 401 → the transport started the authorization flow.
    }
    // The live connection's provider holds the freshly built consent URL.
    const manager = this.mcp as unknown as {
      mcpConnections?: Record<
        string,
        {
          connectionState?: string;
          options?: { transport?: { authProvider?: { authUrl?: string } } };
        }
      >;
      getServersFromStorage?: () => Array<{
        id: string;
        name: string;
        server_url: string;
        client_id: string | null;
        auth_url: string | null;
        callback_url: string;
        server_options: string | null;
      }>;
      saveServerToStorage?: (server: {
        id: string;
        name: string;
        server_url: string;
        client_id: string | null;
        auth_url: string | null;
        callback_url: string;
        server_options: string | null;
      }) => void;
    };
    let url =
      manager.mcpConnections?.gcal?.options?.transport?.authProvider?.authUrl ??
      null;
    if (!url) {
      // The connection was likely restored in the authenticating state, so
      // the probe couldn't run the auth leg. Reset to a fresh anonymous
      // connection and probe again — a persisted auth_url is useless once
      // its OAuth state expires (10 minutes).
      console.log("gcal: resetting connection to mint a fresh consent URL");
      await this.removeMcpServer("gcal");
      await this.addMcpServer("Google Calendar", GCAL_MCP_URL, {
        id: "gcal",
        callbackHost: this.appOrigin(),
        callbackPath: GCAL_CALLBACK_PATH.slice(1),
        transport: { type: "streamable-http" },
      });
      try {
        await this.mcp.callTool({
          serverId: "gcal",
          name: "list_calendars",
          arguments: {},
        });
      } catch {
        // expected 401 — the transport just ran the authorization leg
      }
      url =
        manager.mcpConnections?.gcal?.options?.transport?.authProvider
          ?.authUrl ?? null;
    }
    if (!url) {
      console.warn("gcal: probe ran but no consent URL was produced");
      return null;
    }
    // The anonymous connect left the connection "ready", and the SDK's
    // callback handler short-circuits ready connections as "auth accepted"
    // WITHOUT exchanging the authorization code — so consent silently did
    // nothing. Flip the connection into the authenticating state (live and
    // persisted, so a fresh isolate at callback time restores the same way)
    // to route the callback through the real code exchange.
    const conn = manager.mcpConnections?.gcal;
    if (conn) conn.connectionState = "authenticating";
    const row = manager
      .getServersFromStorage?.()
      .find((server) => server.id === "gcal");
    if (row) manager.saveServerToStorage?.({ ...row, auth_url: url });
    console.log("gcal: consent pending, connection marked authenticating");
    return url;
  }

  /** TEMPORARY: what is keeping this object awake? */
  @callable()
  async diag() {
    const alarm = await this.ctx.storage.getAlarm();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const self = this as any;
    const sql = (q: string) => {
      try {
        return [...this.ctx.storage.sql.exec(q)];
      } catch (e) {
        return [String(e)];
      }
    };
    return {
      now: Date.now(),
      alarmAt: alarm,
      alarmInMs: alarm == null ? null : alarm - Date.now(),
      keepAliveRefs: self._keepAliveRefs,
      pendingFiberRecovery: typeof self._hasPendingFiberRecovery === "function" ? self._hasPendingFiberRecovery() : "n/a",
      schedules: sql("SELECT id, callback, type, time, running FROM cf_agents_schedules"),
      facetRuns: sql("SELECT COUNT(*) AS n FROM cf_agents_facet_runs"),
      tables: sql("SELECT name FROM sqlite_master WHERE type='table'").map((r: { name?: string }) => r.name),
      mcp: Object.fromEntries(
        Object.entries(this.getMcpServers().servers).map(([id, s]) => [id, s.state])
      ),
      pendingMcp: Object.keys(self.mcp?._pendingConnections ?? {}),
    };
  }

  /** The per-user desk instance is the token authority for Google OAuth. */
  private isDesk(): boolean {
    return this.name.endsWith("-desk");
  }

  private async deskStub(netid: string) {
    return getAgentByName(this.env.Pi, `u-${netid}-desk`);
  }

  /** DO-RPC: read the stored Google tokens (desk instance only). */
  async gcalTokensGet(): Promise<unknown> {
    return (await this.ctx.storage.get("gcal_tokens")) ?? null;
  }

  /** DO-RPC: persist Google tokens (desk instance only). */
  async gcalTokensSet(tokens: unknown): Promise<void> {
    await this.ctx.storage.put("gcal_tokens", tokens);
  }

  /** DO-RPC: whether the user has connected Google Calendar. */
  async gcalTokensHas(): Promise<boolean> {
    return (await this.ctx.storage.get("gcal_tokens")) != null;
  }

  private gcalTokenStore(netid: string): GcalTokenStore {
    if (this.isDesk()) {
      return {
        get: () => this.gcalTokensGet(),
        set: (tokens) => this.gcalTokensSet(tokens),
      };
    }
    return {
      get: async () => (await this.deskStub(netid)).gcalTokensGet(),
      set: async (tokens) => (await this.deskStub(netid)).gcalTokensSet(tokens),
    };
  }

  /**
   * Google pre-registers its OAuth client, so the SDK's dynamic-registration
   * provider is replaced with one carrying our client credentials. Engine
   * connections never 401, so this provider is inert for them.
   */
  override createMcpOAuthProvider(_callbackUrl: string): AgentMcpOAuthProvider {
    // The redirect URI is fixed — Google requires an exact pre-registered match.
    const netid = this.getConfig<PiSettings>()?.netid ?? "";
    return new GoogleOAuthProvider(
      this.ctx.storage,
      this.name,
      `${this.appOrigin()}${GCAL_CALLBACK_PATH}`,
      {
        client_id: this.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
        client_secret: this.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "",
      },
      this.gcalTokenStore(netid)
    );
  }

  private appOrigin(): string {
    return (this.env.APP_ORIGIN || "https://pi.tigerapps.org").replace(/\/$/, "");
  }

  private engineBase(): string {
    return (this.env.ENGINE_MCP_BASE || DEFAULT_ENGINE_BASE).replace(/\/$/, "");
  }

  private engineHeaders(netid: string): Record<string, string> {
    const headers: Record<string, string> = {};
    if (netid) {
      headers["x-user-netid"] = netid;
      headers["x-external-user-id"] = netid;
    }
    if (this.env.ENGINE_MCP_TOKEN) {
      headers.authorization = `Bearer ${this.env.ENGINE_MCP_TOKEN}`;
    }
    return headers;
  }
}
