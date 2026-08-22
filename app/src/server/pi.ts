import { createAnthropic } from "@ai-sdk/anthropic";
import { Think } from "@cloudflare/think";
import { callable, getAgentByName } from "agents";
import type { AgentMcpOAuthProvider } from "agents/mcp/do-oauth-client-provider";
import type { UIMessage } from "ai";
import {
  GCAL_CALLBACK_PATH,
  GCAL_MCP_URL,
  GoogleOAuthProvider,
  type GcalTokenStore,
} from "./gcal";
import {
  DEFAULT_ENGINE_BASE,
  PI_APPS,
  type AppKey,
  type PiSettings,
} from "../shared/apps";

export type PiState = {
  settings: PiSettings | null;
  /** Per-app connection errors from the last reconcile, for the UI. */
  appErrors: Partial<Record<AppKey, string>>;
  /** OAuth consent URLs awaiting the user (e.g. Google Calendar). */
  authUrls?: Partial<Record<AppKey, string>>;
};

const CLAUDE_MODELS = new Set(["claude-opus-5", "claude-sonnet-5"]);
const DEFAULT_CLAUDE_MODEL = "claude-opus-5";
/** Free-plan-compatible Workers AI model with solid tool calling. */
const CAMPUS_MODEL = "@cf/zai-org/glm-4.7-flash";

/**
 * PI — a lightweight Princeton chat agent. One Durable Object instance per
 * conversation. Princeton data arrives through the junction engine's scoped
 * MCP endpoints, spoken over MCP v2 stateless streamable HTTP.
 */
export class Pi extends Think<Env, PiState> {
  initialState: PiState = { settings: null, appErrors: {}, authUrls: {} };

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
    if (preference !== "campus" && key) {
      const model = CLAUDE_MODELS.has(preference)
        ? preference
        : DEFAULT_CLAUDE_MODEL;
      return createAnthropic({ apiKey: key })(model);
    }
    return CAMPUS_MODEL;
  }

  getSystemPrompt() {
    const settings = this.getConfig<PiSettings>();
    const today = new Date().toLocaleDateString("en-CA", {
      timeZone: "America/New_York",
    });
    const connected = PI_APPS.filter((a) => settings?.apps.includes(a.key));
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
        : "No TigerApps are connected. Tell the student to enable some on the My apps page if they ask for Princeton data.",
      "",
      "Ground rules:",
      "- Princeton term codes end in 2 for Fall and 4 for Spring (e.g. 1272 = Fall 2026). When unsure which term is current, call list_terms rather than guessing.",
      "- The interface renders schedule and course tool results as visual cards automatically. After a tool call, add a short takeaway (conflicts, standouts, next step) — never re-list every row the card already shows.",
      "- When a tool errors or returns nothing, say so plainly and suggest the closest thing you can do instead.",
      "- Before destructive changes (deleting a schedule, removing courses), confirm with the student first.",
      "- Keep answers tight. Prefer a short paragraph or a few bullets over headers and long lists.",
      settings?.apps.includes("gcal")
        ? "- Google Calendar is connected read-only: use its tools for the student's real events and free/busy when planning around their week. You cannot modify their calendar."
        : "",
    ].join("\n");
  }

  /**
   * Push settings from the client, then reconcile MCP connections to match.
   * Identity travels as headers on each connection, so a netid change forces
   * a reconnect of every app.
   */
  @callable()
  async setup(settings: PiSettings) {
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
    const enabled = new Set<AppKey>(settings.apps);
    // The princetoncourses MCP scope is a strict subset of junction's, so
    // connecting both would register every shared tool twice. Junction wins.
    if (enabled.has("junction")) enabled.delete("princetoncourses");
    const base = this.engineBase();
    const expectedUrl = (app: (typeof PI_APPS)[number]) =>
      app.mcpUrl ?? `${base}${app.mcpPath}`;

    // Land the user back on My apps after a Google consent round-trip.
    this.mcp.configureOAuthCallback({
      successRedirect: "/apps",
      errorRedirect: "/apps",
    });

    for (const [id, server] of Object.entries(this.getMcpServers().servers)) {
      const app = PI_APPS.find((a) => a.key === id);
      const stale =
        !app ||
        !enabled.has(app.key) ||
        (identityChanged && app.key !== "gcal") ||
        server.server_url !== expectedUrl(app);
      if (stale) await this.removeMcpServer(id);
    }

    const connectedIds = new Set(Object.keys(this.getMcpServers().servers));
    for (const app of PI_APPS) {
      if (!enabled.has(app.key) || connectedIds.has(app.key)) continue;
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
        appErrors[app.key] = err instanceof Error ? err.message : String(err);
      }
    }

    this.setState({ settings, appErrors, authUrls });
    return { ok: true as const, appErrors, authUrls };
  }

  /**
   * Direct MCP tool call for non-chat surfaces (planner, agenda). Returns the
   * tool's JSON payload parsed from its text content.
   */
  @callable()
  async callAppTool(app: AppKey, name: string, args: Record<string, unknown>) {
    if (!this.getMcpServers().servers[app]) {
      throw new Error(`${app} is not connected`);
    }
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
