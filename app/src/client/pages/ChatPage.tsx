import { useAgentChat } from "@cloudflare/think/react";
import { AgentClient } from "agents/client";
import { useAgent } from "agents/react";
import {
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { UIMessage } from "ai";
import {
  PI_APPS,
  PI_MODELS,
  type AppKey,
  type PiModel,
  type PiSettings,
} from "../../shared/apps";
import { Composer } from "../components/Composer";
import {
  IconArrowUp,
  IconCheck,
  IconCopy,
  IconFork,
  IconInfo,
  IconRetry,
  IconRewind,
  IconSpark,
  PiMark,
} from "../components/Icons";
import { Markdown } from "../components/Markdown";
import { ToolRender } from "../components/ToolCards";
import { reportUnauthorized, userInstance, type Identity } from "../lib/auth";
import {
  dismissNotes,
  newChatId,
  readNotesDismissed,
  savePrefs,
  upsertChat,
  useChats,
} from "../lib/store";
import {
  APP_INK,
  APP_REQUEST_PART,
  CHOICES_PART,
  appDisplayName,
  ownerOf,
  parseAppRequest,
  parseChoicesAsk,
  parseToolPart,
  type AppRequest,
  type ChoicesAsk,
} from "../lib/tools";
import "../styles/chat.css";

/** Stable empty array: a draft chat has nothing to hydrate from. */
const NO_MESSAGES: UIMessage[] = [];

/** How close to the bottom still counts as "following along", in px. */
const STICK_SLACK = 80;

/**
 * Starters, each tagged with the TigerApp that has to be on for PI to answer
 * it. Filtering by the student's own switches is what keeps a chip from being
 * a guaranteed dead end.
 */
const SUGGESTIONS: Array<{ needs: AppKey; text: string }> = [
  { needs: "junction", text: "What does my schedule look like this semester?" },
  {
    needs: "princetoncourses",
    text: "Find me a well-rated LA course with no Friday classes",
  },
  { needs: "path", text: "What's left before I graduate?" },
  {
    needs: "snatch",
    text: "Which COS courses is everyone fighting over right now?",
  },
  { needs: "junction", text: "Does anything in my schedule collide?" },
  {
    needs: "gcal",
    text: "Would a 10am section clash with anything on my calendar?",
  },
  {
    needs: "princetoncourses",
    text: "What did people actually say about COS 226?",
  },
];

/**
 * What one more switched-off app would add, in the order we'd suggest it.
 * PrincetonCourses isn't here: its tools arrive through TigerJunction's scope
 * either way (see setup in server/pi.ts), so offering it would be selling a
 * student something they already have.
 */
const OFFERS: Array<{ key: AppKey; line: string }> = [
  {
    key: "path",
    line: "TigerPath would let PI answer what's actually left before you graduate.",
  },
  {
    key: "gcal",
    line: "Google Calendar would let PI plan around what's already in your week.",
  },
];

/** One placeholder per chat, picked from the id so it never shuffles mid-chat. */
const PLACEHOLDERS = [
  "Ask like you'd text the friend who already took it…",
  "Say it messy. PI will sort it out…",
  "What's the plan, or what's the problem?",
];

/** The slice of the agent's state a chat listens to (see PiState on the server). */
type ChatAgentState = { connectError?: string; gcalReady?: boolean };

type ChatPageProps = {
  chatId: string;
  /** True when this chat hasn't been sent to yet (the "/" home state). */
  isDraft: boolean;
  identity: Identity;
  settings: PiSettings;
  navigate: (path: string, replace?: boolean) => void;
};

export function ChatPage(props: ChatPageProps) {
  // Decided once, at mount. A draft that turns into a real chat mid-sentence
  // must not suddenly suspend on a history fetch for a transcript it wrote.
  const [skipHistory] = useState(props.isDraft);
  return (
    <Suspense fallback={<ChatSkeleton />}>
      <ChatBody {...props} skipHistory={skipHistory} />
    </Suspense>
  );
}

function ChatBody({
  chatId,
  isDraft,
  identity,
  settings,
  navigate,
  skipHistory,
}: ChatPageProps & { skipHistory: boolean }) {
  // The server flags a turn that ran without its TigerApps and names them. To
  // a student that's the same failure as a setup push that didn't land, so
  // both light the one strip below. `gcalReady` rides along on the same state:
  // only the desk knows whether Google actually handed the calendar over, and
  // a consent card must not call it on until it has.
  const [engineNote, setEngineNote] = useState<string | null>(null);
  const [gcalReady, setGcalReady] = useState(false);
  const agent = useAgent({
    agent: "pi",
    name: userInstance(identity.netid, chatId),
    onStateUpdate: (state: ChatAgentState | null) => {
      setEngineNote(state?.connectError ?? null);
      setGcalReady(state?.gcalReady === true);
    },
  });
  // `getInitialMessages: null` short-circuits the get-messages fetch, so a
  // draft never pays a cold Durable Object round trip for an empty transcript.
  const chat = useAgentChat(
    skipHistory
      ? { agent, getInitialMessages: null, messages: NO_MESSAGES }
      : { agent }
  );
  const {
    messages,
    sendMessage,
    status,
    stop,
    regenerate,
    connectionError,
    error,
    clearError,
    isStreaming,
    isRecovering,
  } = chat;
  const chats = useChats(identity.netid);

  const scrollRef = useRef<HTMLDivElement>(null);
  /** False once the student scrolls away from the bottom to read back. */
  const stickRef = useRef(true);
  const settingsHash = useMemo(() => JSON.stringify(settings), [settings]);
  const appliedRef = useRef<string | null>(null);
  const startedRef = useRef(false);
  const [busyAction, setBusyAction] = useState<BusyAction | null>(null);
  const [branchFailed, setBranchFailed] = useState(false);
  const [setupFailed, setSetupFailed] = useState(false);
  const [sendFailure, setSendFailure] = useState<string | null>(null);
  const [detached, setDetached] = useState(false);

  // Settings the next `setup` push should carry. Held in a ref so a consent
  // card can flip an app on and send in the same tick, before React re-renders.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  /** Turns already on screen at mount don't replay their entry animation. */
  const seenRef = useRef<Set<string> | null>(null);
  if (seenRef.current === null) {
    seenRef.current = new Set(messages.map((m) => m.id));
  }

  // Locally echoed sends, shown between Enter and the hook's own append.
  const [pending, setPending] = useState<Echo[]>([]);
  const echoSeq = useRef(0);
  // Send times for messages written in this session. History gets none —
  // the transcript carries no timestamps, and inventing them would be a lie.
  const [stamps, setStamps] = useState<Record<string, number>>({});

  // A rewind from another chat may have left a draft for this one.
  const [draft] = useState(() => {
    try {
      const d = sessionStorage.getItem(`pi:draft:${chatId}`);
      if (d) sessionStorage.removeItem(`pi:draft:${chatId}`);
      return d ?? "";
    } catch {
      return "";
    }
  });

  /**
   * Push settings to the agent (fast — MCP connections open server-side in
   * beforeTurn, not here).
   */
  async function ensureSetup() {
    const wanted = settingsRef.current;
    const hash = JSON.stringify(wanted);
    if (appliedRef.current === hash) return;
    appliedRef.current = hash;
    try {
      await agent.ready;
      await agent.call("setup", [wanted]);
      setSetupFailed(false);
    } catch (err) {
      console.warn("PI setup failed", err);
      if (appliedRef.current === hash) appliedRef.current = null;
      setSetupFailed(true);
    }
  }

  // Sends run strictly in click order: a slow settings push for one message
  // must never let a later message overtake it on the wire.
  const sendChain = useRef(Promise.resolve());

  // Apply changed settings to a conversation that's already underway.
  useEffect(() => {
    if (startedRef.current || messages.length > 0) void ensureSetup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsHash, messages.length > 0]);

  // A dropped socket is the first thing that notices a lapsed session: the
  // upgrade gets a 401 and the browser reports a plain abnormal close, with no
  // status to read. So ask the shell to re-check who's signed in. It's
  // self-correcting — a live session re-confirms and nothing on screen moves,
  // a lapsed one raises the sign-back-in card instead of leaving this strip
  // and a dead composer sitting there.
  // Once per outage, not once per retry: the socket backs off and retries, and
  // each failure is a fresh error object.
  const askedWhoRef = useRef(false);
  useEffect(() => {
    if (!connectionError) {
      askedWhoRef.current = false;
      return;
    }
    if (askedWhoRef.current) return;
    askedWhoRef.current = true;
    reportUnauthorized();
  }, [connectionError]);

  // Open a saved chat already scrolled to the end, with no replay of the
  // whole conversation on the way down.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "instant" });
  }, []);

  // Follow the stream only while the student is actually at the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, status, pending]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < STICK_SLACK;
    stickRef.current = atBottom;
    setDetached((was) => (was === !atBottom ? was : !atBottom));
  }

  function jumpToLatest() {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = true;
    setDetached(false);
    // An explicit behavior wins over the stylesheet's reduced-motion rule, so
    // this is the one place that has to ask for the preference itself.
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: still ? "instant" : "smooth",
    });
  }

  // Retire an echo once its real message has landed, and keep its send time.
  useEffect(() => {
    if (pending.length === 0) return;
    const sent = messages.filter((m) => m.role === "user");
    const landed = pending.filter((p) => sent.length > p.ordinal);
    if (landed.length === 0) return;
    setStamps((prev) => {
      const next = { ...prev };
      for (const p of landed) {
        const m = sent[p.ordinal];
        if (m && next[m.id] == null) next[m.id] = p.at;
      }
      return next;
    });
    setPending((prev) => prev.filter((p) => sent.length <= p.ordinal));
  }, [messages, pending]);

  function send(text: string) {
    startedRef.current = true;
    if (isDraft) navigate(`/chat/${chatId}`, true);
    upsertChat(identity.netid, {
      id: chatId,
      title: firstTitle(messages) ?? text.slice(0, 48),
      at: Date.now(),
    });
    setSendFailure(null);
    // The words go on screen now, not after the settings push resolves. The
    // ordinal is the slot this message will occupy among the user's turns,
    // which is how the echo knows when its real counterpart has landed.
    const echo = { key: `echo-${echoSeq.current++}`, text, at: Date.now() };
    const landed = messages.filter((m) => m.role === "user").length;
    setPending((prev) => [
      ...prev,
      { ...echo, ordinal: landed + prev.length },
    ]);
    sendChain.current = sendChain.current
      .then(async () => {
        // The first message of a chat needs settings on the server; bound the
        // wait so a slow push can never swallow a message silently.
        await Promise.race([
          ensureSetup(),
          new Promise((resolve) => setTimeout(resolve, 4000)),
        ]);
        void sendMessage({ text });
      })
      // A throw here would poison the chain and kill every later send, so it
      // stops at this link and surfaces instead.
      .catch((err) => {
        console.warn("send failed", err);
        setPending([]);
        setSendFailure(text);
      });
  }

  /** Chips can't queue a duplicate turn during the silent send window. */
  function sendSuggestion(text: string) {
    if (busy || pending.length > 0) return;
    send(text);
  }

  function grantApp(app: AppKey) {
    const apps = settings.apps.includes(app)
      ? settings.apps
      : [...settings.apps, app];
    settingsRef.current = { ...settings, apps };
    savePrefs(identity.netid, { apps, model: settings.model });
    // Google Calendar takes a second yes, Google's own, and only My apps can
    // ask for it. The switch alone would leave PI reaching for a calendar it
    // still can't read, so walk the student over instead of reporting success.
    if (app === "gcal") {
      navigate("/apps");
      return;
    }
    send(`I turned on ${appDisplayName(app)}, go ahead.`);
  }

  /** Copy history up to `endIndex` (exclusive) into a fresh chat. */
  async function branch(
    endIndex: number,
    action: BusyAction,
    draftText?: string
  ): Promise<void> {
    const slice = messages.slice(0, endIndex);
    const id = newChatId();
    setBranchFailed(false);
    setBusyAction(action);
    try {
      const client = new AgentClient({
        agent: "pi",
        name: userInstance(identity.netid, id),
        host: location.host,
      });
      await client.ready;
      if (slice.length > 0) await client.call("importHistory", [slice]);
      await client.call("setup", [settingsRef.current]);
      client.close();
      const current = chats.find((c) => c.id === chatId);
      const base = current?.title ?? firstTitle(messages) ?? "this chat";
      upsertChat(identity.netid, {
        id,
        title: `${base} (offshoot)`.slice(0, 48),
        at: Date.now(),
      });
      if (draftText) {
        try {
          sessionStorage.setItem(`pi:draft:${id}`, draftText);
        } catch {
          /* draft is a nicety */
        }
      }
      navigate(`/chat/${id}`);
    } catch (err) {
      console.warn("branch failed", err);
      setBranchFailed(true);
    } finally {
      setBusyAction(null);
    }
  }

  const busy = status === "submitted" || isStreaming || isRecovering;
  const turnFailed = status === "error" || error != null;
  const empty = messages.length === 0 && pending.length === 0;
  const name = greetingName(identity);
  const prompts = useMemo(() => pickPrompts(settings.apps), [settings.apps]);
  const lastAssistantId = [...messages]
    .reverse()
    .find((m) => m.role === "assistant")?.id;
  const lastUserIndex = messages.reduce(
    (acc, m, i) => (m.role === "user" ? i : acc),
    -1
  );

  function retryTurn() {
    clearError();
    setSendFailure(null);
    void regenerate();
  }

  const modelSwitch = (
    <select
      className="model-select"
      aria-label="Which model answers"
      value={settings.model}
      onChange={(e) =>
        savePrefs(identity.netid, {
          apps: settings.apps,
          model: e.target.value as PiModel,
        })
      }
    >
      {PI_MODELS.map((m) => (
        <option key={m.value} value={m.value}>
          {m.label}
        </option>
      ))}
    </select>
  );

  return (
    <>
      {connectionError && (
        <div className="conn-strip" role="alert">
          <span title={connectionError.reason}>
            PI can&rsquo;t stay connected to this chat.
          </span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => location.reload()}
          >
            reload
          </button>
        </div>
      )}
      <div className="chat-body">
        <div className="chat-scroll" ref={scrollRef} onScroll={onScroll}>
          <div className="chat-column">
            {empty ? (
              <>
                <div className="hello">
                  <span className="pi-lozenge pi-lozenge-lg">
                    <PiMark size={30} />
                  </span>
                  <h1>
                    Hello <span className="name hand-underline">{name}</span>,
                  </h1>
                  <p>
                    what are we working on?{" "}
                    <span className="hand">
                      pick one below, or just start typing
                    </span>
                  </p>
                  <div className="prompts">
                    {prompts.length > 0 ? (
                      prompts.map((s) => (
                        <button
                          key={s.text}
                          className="prompt-chip"
                          disabled={busy || pending.length > 0}
                          onClick={() => sendSuggestion(s.text)}
                        >
                          <IconSpark size={14} className="icon pen" />
                          {s.text}
                        </button>
                      ))
                    ) : (
                      <button
                        className="prompt-chip to-apps"
                        onClick={() => navigate("/apps")}
                      >
                        <IconSpark size={14} className="icon pen" />
                        Nothing is switched on yet. Pick your apps first.
                      </button>
                    )}
                  </div>
                </div>
                <HomeNotes
                  netid={identity.netid}
                  apps={settings.apps}
                  navigate={navigate}
                />
              </>
            ) : (
              <div
                className="transcript"
                role="log"
                aria-label="Conversation"
                aria-busy={busy}
              >
                {messages.map((m, i) => (
                  <Turn
                    key={m.id}
                    message={m}
                    fresh={!seenRef.current!.has(m.id)}
                    time={messageTime(m, stamps)}
                    answered={i < lastUserIndex || pending.length > 0}
                    enabledApps={settings.apps}
                    gcalReady={gcalReady}
                    actionsDisabled={busy || busyAction != null}
                    isLastAssistant={m.id === lastAssistantId}
                    running={busyAction?.id === m.id ? busyAction.kind : null}
                    onReply={send}
                    onGrant={grantApp}
                    onRewind={
                      m.role === "user"
                        ? () =>
                            void branch(
                              i,
                              { kind: "rewind", id: m.id },
                              messageText(m)
                            )
                        : undefined
                    }
                    onFork={
                      m.role === "assistant"
                        ? () => void branch(i + 1, { kind: "fork", id: m.id })
                        : undefined
                    }
                    onRegenerate={
                      m.role === "assistant" && m.id === lastAssistantId
                        ? () => void regenerate()
                        : undefined
                    }
                  />
                ))}
                {pending.map((p) => (
                  <div key={p.key} className="turn user echo turn-in">
                    <p className="said">{p.text}</p>
                    <span className="timestamp">{fmtClock(p.at)}</span>
                  </div>
                ))}
              </div>
            )}
            {/* an echoed send counts as work in flight: the nib must never
                vanish between Enter and the first token */}
            {(pending.length > 0 || (busy && lastIsUser(messages))) && (
              <p className="writing" role="status">
                <span className="nib" />
                {isRecovering ? "picking that back up…" : "pi is writing…"}
              </p>
            )}
            {/* the visible progress lives on the button that was clicked, so
                forking from the top of a long chat isn't announced off-screen */}
            {busyAction && (
              <p className="sr-only" role="status">
                copying this conversation…
              </p>
            )}
            {turnFailed && (
              <div className="turn-error" role="alert">
                <div className="what">
                  <div className="lead">that one didn&rsquo;t land</div>
                  <div className="detail" title={error?.message}>
                    PI stopped partway through. Nothing you wrote was lost.
                  </div>
                </div>
                <div className="fix">
                  <button className="btn btn-ghost btn-sm" onClick={retryTurn}>
                    <IconRetry size={14} /> try again
                  </button>
                </div>
              </div>
            )}
            {sendFailure && (
              <div className="turn-error" role="alert">
                <div className="what">
                  <div className="lead">that message never went out</div>
                  <div className="detail">
                    PI couldn&rsquo;t get it to your desk.
                  </div>
                </div>
                <div className="fix">
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      const again = sendFailure;
                      setSendFailure(null);
                      send(again);
                    }}
                  >
                    <IconRetry size={14} /> send it again
                  </button>
                </div>
              </div>
            )}
            {branchFailed && (
              <div className="turn-error" role="alert">
                <div className="what">
                  <div className="lead">that copy didn&rsquo;t take</div>
                  <div className="detail">
                    PI couldn&rsquo;t open the new chat. This one is untouched.
                  </div>
                </div>
                <div className="fix">
                  <button
                    className="btn btn-quiet btn-sm"
                    onClick={() => setBranchFailed(false)}
                  >
                    dismiss
                  </button>
                </div>
              </div>
            )}
            {(setupFailed || engineNote) && (
              <div className="setup-note" role="status">
                {/* the server names the apps it couldn't use; a setup push that
                    never landed has no names to give, so it falls back */}
                <span className="what">
                  {engineNote ??
                    "PI couldn’t reach your TigerApps just now, so answers may be missing course data."}
                </span>
                <button
                  className="btn btn-quiet btn-sm"
                  onClick={() => {
                    appliedRef.current = null;
                    setEngineNote(null);
                    void ensureSetup();
                  }}
                >
                  try again
                </button>
              </div>
            )}
          </div>
        </div>
        {detached && busy && (
          <button className="btn btn-sm jump-latest" onClick={jumpToLatest}>
            <IconArrowUp size={14} /> jump to latest
          </button>
        )}
      </div>
      <Composer
        onSend={send}
        onStop={stop}
        busy={busy}
        placeholder={placeholderFor(chatId)}
        initialText={draft}
        accessory={modelSwitch}
      />
    </>
  );
}

/* ── the second beat of the home screen ──────────────────────────── */

/**
 * Below the greeting: a note about what today's summary holds, one suggestion
 * drawn from the student's own switches, and the line about what PI is allowed
 * to read. Every word here comes from the date or their preferences — this is
 * not a place to print campus news PI hasn't actually read.
 */
function HomeNotes({
  netid,
  apps,
  navigate,
}: {
  netid: string;
  apps: AppKey[];
  navigate: (path: string, replace?: boolean) => void;
}) {
  const now = new Date();
  // Local calendar day, so a dismissal lasts until tomorrow rather than until
  // UTC midnight lands mid-afternoon.
  const day = now.toLocaleDateString("en-CA");
  const [dismissed, setDismissed] = useState(
    () => readNotesDismissed(netid) === day
  );

  const junctionOn = apps.includes("junction");
  // With TigerJunction off, the note is already asking for TigerJunction —
  // a second ask underneath it would just be nagging.
  const offer = junctionOn
    ? OFFERS.find((o) => !apps.includes(o.key))
    : undefined;

  return (
    <section className="home-notes" aria-label="Today">
      {!dismissed && (
        <article className="today-note paper-stack">
          <span className="note-day">
            {now.toLocaleDateString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
          </span>
          <h2>Today&rsquo;s summary, one page over.</h2>
          <p>
            {junctionOn
              ? "Your classes for today, the seats you’re watching and what’s trending on campus sit together there."
              : "Switch TigerJunction on and it fills up: today’s classes, the seats you’re watching, what’s trending on campus."}
          </p>
          {offer && <p className="note-offer">{offer.line}</p>}
          <div className="note-acts">
            <button
              className="btn btn-fill btn-sm"
              onClick={() => navigate("/agenda")}
            >
              read more
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                dismissNotes(netid, day);
                setDismissed(true);
              }}
            >
              dismiss
            </button>
          </div>
        </article>
      )}

      <p className="home-privacy">
        PI only uses data from the apps and calendars{" "}
        <span className="hand-underline">you approve of</span>.
      </p>
      <button className="btn btn-ghost btn-sm" onClick={() => navigate("/apps")}>
        take me to the app library
      </button>
    </section>
  );
}

/* ── the shape of a chat, while its transcript is on the way ─────── */

function ChatSkeleton() {
  return (
    <>
      <div className="chat-body">
        <div className="chat-scroll">
          <div className="chat-column chat-skeleton" aria-busy="true">
            <p className="sr-only">Opening this chat.</p>
            <div className="sk-turn mine">
              <div className="skel skel-line" />
            </div>
            <div className="sk-turn theirs">
              <div className="skel skel-line" />
              <div className="skel skel-line" />
              <div className="skel skel-line" />
            </div>
            <div className="sk-turn theirs">
              <div className="skel sk-card" />
            </div>
            <div className="sk-turn mine">
              <div className="skel skel-line" />
            </div>
            <div className="sk-turn theirs">
              <div className="skel skel-line" />
              <div className="skel skel-line" />
            </div>
          </div>
        </div>
      </div>
      <div className="composer-wrap">
        <div className="composer">
          <div className="skel sk-composer" />
        </div>
        <div className="sk-note-row">
          <div className="skel sk-note" />
        </div>
      </div>
    </>
  );
}

/* ── helpers ─────────────────────────────────────────────────────── */

type Echo = { key: string; text: string; at: number; ordinal: number };

type BusyAction = { kind: "rewind" | "fork"; id: string };

/**
 * A stream interruption + recovery can split one utterance across several
 * consecutive text parts (often mid-sentence). Rendering each part as its
 * own markdown block tears sentences and lists apart, so stitch runs of
 * text parts back together before rendering.
 */
function coalesceParts(parts: UIMessage["parts"]): UIMessage["parts"] {
  const out: UIMessage["parts"] = [];
  for (const part of parts) {
    const last = out[out.length - 1];
    if (part.type === "text" && last?.type === "text") {
      out[out.length - 1] = { ...last, text: last.text + part.text };
    } else {
      out.push(part);
    }
  }
  return out;
}

function messageText(m: UIMessage): string {
  return m.parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("")
    .trim();
}

function firstTitle(messages: UIMessage[]): string | null {
  const first = messages.find((m) => m.role === "user");
  if (!first) return null;
  const text = messageText(first);
  return text ? text.slice(0, 48) : null;
}

function lastIsUser(messages: UIMessage[]): boolean {
  const last = messages[messages.length - 1];
  if (!last) return false;
  if (last.role === "user") return true;
  return !last.parts.some((p) => p.type === "text" && p.text.trim() !== "");
}

/**
 * Directories hand back "Doe, Jane" about as often as "Jane Doe", and the
 * netid fallback ("Hello jd1234,") is the coldest possible greeting — so a
 * name PI can't vouch for becomes no name at all.
 */
function greetingName(identity: Identity): string {
  const raw = identity.name?.trim() ?? "";
  const afterComma = raw.includes(",") ? raw.slice(raw.indexOf(",") + 1) : raw;
  const first = (afterComma.trim().split(/\s+/)[0] ?? "").replace(
    /[^\p{L}\p{M}'-]/gu,
    ""
  );
  if (!first || first.toLowerCase() === identity.netid.toLowerCase()) {
    return "there";
  }
  // Only normalize the shouted and the all-lowercase; leave McKay alone.
  return first === first.toLowerCase() || first === first.toUpperCase()
    ? first[0].toUpperCase() + first.slice(1).toLowerCase()
    : first;
}

function pickPrompts(apps: AppKey[]): Array<{ needs: AppKey; text: string }> {
  const on = new Set(apps);
  const usable = SUGGESTIONS.filter((s) => on.has(s.needs));
  const picked: typeof usable = [];
  const covered = new Set<AppKey>();
  // One per app first, so four chips never all lean on the same TigerApp.
  for (const s of usable) {
    if (covered.has(s.needs)) continue;
    covered.add(s.needs);
    picked.push(s);
  }
  for (const s of usable) {
    if (picked.length >= 4) break;
    if (!picked.includes(s)) picked.push(s);
  }
  return picked.slice(0, 4);
}

function placeholderFor(chatId: string): string {
  let sum = 0;
  for (let i = 0; i < chatId.length; i++) sum += chatId.charCodeAt(i);
  return PLACEHOLDERS[sum % PLACEHOLDERS.length];
}

/** Send time from the message itself, else the one we recorded on send. */
function messageTime(
  m: UIMessage,
  stamps: Record<string, number>
): number | null {
  const raw = (m.metadata as { createdAt?: unknown } | undefined)?.createdAt;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return stamps[m.id] ?? null;
}

function fmtClock(at: number): string {
  return new Date(at).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Most tool names read as plain English once the underscores go, so the
 * list only names the handful that read as machinery: the seat-watch tools
 * carry TigerSnatch's own name inside them, which the app column already
 * said.
 */
const TOOL_PHRASES: Record<string, string> = {
  get_snatch_subscriptions: "check the seats you're watching",
  subscribe_to_snatch: "watch a section for a seat",
  unsubscribe_from_snatch: "stop watching a section",
};

function humanTool(base: string): string {
  return TOOL_PHRASES[base] ?? base.replace(/[_-]+/g, " ").trim();
}

/* ── one turn ────────────────────────────────────────────────────── */

function Turn({
  message,
  fresh,
  time,
  answered,
  enabledApps,
  gcalReady,
  actionsDisabled,
  isLastAssistant,
  running,
  onReply,
  onGrant,
  onRewind,
  onFork,
  onRegenerate,
}: {
  message: UIMessage;
  fresh: boolean;
  time: number | null;
  /** True once the student has spoken again, which settles any open card. */
  answered: boolean;
  enabledApps: AppKey[];
  /** Whether the desk actually holds Google tokens. */
  gcalReady: boolean;
  actionsDisabled: boolean;
  isLastAssistant: boolean;
  running: BusyAction["kind"] | null;
  onReply: (text: string) => void;
  onGrant: (app: AppKey) => void;
  onRewind?: () => void;
  onFork?: () => void;
  onRegenerate?: () => void;
}) {
  const [copyState, setCopyState] = useState<"idle" | "done" | "failed">(
    "idle"
  );

  function copy() {
    const settle = (next: "done" | "failed") => {
      setCopyState(next);
      window.setTimeout(() => setCopyState("idle"), 1800);
    };
    try {
      navigator.clipboard.writeText(messageText(message)).then(
        () => settle("done"),
        () => settle("failed")
      );
    } catch {
      settle("failed");
    }
  }

  const actions = (
    <div
      className="msg-actions"
      role="toolbar"
      aria-label="What you can do with this message"
    >
      <button onClick={copy} title="Copy this out" disabled={actionsDisabled}>
        {copyState === "done" ? (
          <>
            <IconCheck size={14} className="icon said-it" /> copied
          </>
        ) : copyState === "failed" ? (
          <>
            <IconCopy size={14} className="icon no-dice" /> couldn&rsquo;t copy
          </>
        ) : (
          <>
            <IconCopy size={14} /> copy
          </>
        )}
      </button>
      {onRewind && (
        <button
          onClick={onRewind}
          title="Take it back and ask it differently"
          disabled={actionsDisabled}
        >
          <IconRewind size={14} />
          {running === "rewind" ? "copying…" : "rewind"}
        </button>
      )}
      {onFork && (
        <button
          onClick={onFork}
          title="Split off a new chat from here"
          disabled={actionsDisabled}
        >
          <IconFork size={14} />
          {running === "fork" ? "copying…" : "fork"}
        </button>
      )}
      {onRegenerate && isLastAssistant && (
        <button
          onClick={onRegenerate}
          title="Have another go at this answer"
          disabled={actionsDisabled}
        >
          <IconRetry size={14} /> retry
        </button>
      )}
    </div>
  );

  if (message.role === "user") {
    return (
      <div className={`turn user${fresh ? " turn-in" : ""}`}>
        <p className="said">{messageText(message)}</p>
        {time != null && <span className="timestamp">{fmtClock(time)}</span>}
        {actions}
      </div>
    );
  }

  const parts = coalesceParts(message.parts);
  const body = parts
    .map((part, i): React.ReactElement | null => {
      const ask = parseChoicesAsk(part);
      if (ask) {
        return (
          <Choices key={i} ask={ask} answered={answered} onReply={onReply} />
        );
      }
      const request = parseAppRequest(part);
      if (request) {
        // The calendar is on only once Google has handed it over: the local
        // switch is half the yes, and the desk holds the other half.
        const on =
          request.app === "gcal"
            ? enabledApps.includes("gcal") && gcalReady
            : enabledApps.includes(request.app);
        return (
          <Consent
            key={i}
            request={request}
            settled={answered || on}
            alreadyOn={on}
            halfGranted={
              request.app === "gcal" && !on && enabledApps.includes("gcal")
            }
            onGrant={onGrant}
            onDecline={() =>
              onReply(
                `Not right now, answer without ${appDisplayName(request.app)}.`
              )
            }
          />
        );
      }
      // The two elicitation parts are drawn above or not at all — they are
      // never tool chips, the way WorkedFrom already treats them. One that
      // arrived unusable (no options, an app key PI doesn't have) falls
      // through to the stalled note below.
      if (part.type === CHOICES_PART || part.type === APP_REQUEST_PART) {
        return null;
      }
      if (part.type === "text") {
        return part.text.trim() ? <Markdown key={i} text={part.text} /> : null;
      }
      if (part.type === "reasoning") {
        const text = (part as { text?: string }).text?.trim();
        if (!text) return null;
        return (
          <details key={i} className="reasoning">
            <summary>Thought process</summary>
            <div className="body">{text}</div>
          </details>
        );
      }
      const tool = parseToolPart(part);
      // A card may offer the student a follow-up (undo a watch, pick a
      // section). It goes out as an ordinary message on the same path a
      // choice does, and settles once they've spoken again.
      if (tool) {
        return (
          <ToolRender
            key={i}
            view={tool}
            onSend={onReply}
            settled={answered}
          />
        );
      }
      return null;
    })
    .filter((node): node is React.ReactElement => node !== null);

  // An unusable ask ends the turn on the server (see stopWhen in server/pi.ts),
  // so nothing else is coming for this message. Say that, rather than leaving
  // a turn with nothing in it.
  const stalledAsk =
    body.length === 0 &&
    parts.some(
      (part) =>
        (part.type === CHOICES_PART || part.type === APP_REQUEST_PART) &&
        (part as { state?: string }).state !== "input-streaming"
    );

  return (
    <div className={`turn assistant${fresh ? " turn-in" : ""}`}>
      <WorkedFrom message={message} />
      {body}
      {stalledAsk && (
        <div className="turn-error" role="status">
          <div className="what">
            <div className="lead">that question didn&rsquo;t come through</div>
            <div className="detail">
              PI meant to ask you something and it arrived empty.
            </div>
          </div>
          {onRegenerate && isLastAssistant && (
            <div className="fix">
              <button
                className="btn btn-ghost btn-sm"
                onClick={onRegenerate}
                disabled={actionsDisabled}
              >
                <IconRetry size={14} /> ask again
              </button>
            </div>
          )}
        </div>
      )}
      {messageText(message) !== "" && actions}
    </div>
  );
}

/**
 * "Worked from ● TigerJunction ● TigerSnatch", derived from the calls. The
 * app named is the one the data belongs to, not the connection that carried
 * it: with TigerJunction on, seat-watch tools arrive over its scope, and a
 * student reading this is owed TigerSnatch's name.
 */
function WorkedFrom({ message }: { message: UIMessage }) {
  const calls = useMemo(() => {
    const out: Array<{ app: AppKey | null; base: string }> = [];
    for (const part of message.parts) {
      if (part.type === CHOICES_PART || part.type === APP_REQUEST_PART) {
        continue;
      }
      const tool = parseToolPart(part);
      if (tool) out.push({ app: ownerOf(tool), base: tool.base });
    }
    return out;
  }, [message.parts]);

  if (calls.length === 0) return null;

  const apps: Array<AppKey | null> = [];
  for (const c of calls) if (!apps.includes(c.app)) apps.push(c.app);

  return (
    <div className="worked-from">
      <span>Worked from</span>
      {apps.map((app) => (
        <span className="wf-app" key={app ?? "pi"}>
          <span
            className="wf-dot"
            style={
              {
                "--wf-color": app ? APP_INK[app] : "var(--ink-ghost)",
              } as React.CSSProperties
            }
          />
          {appDisplayName(app)}
        </span>
      ))}
      <details className="wf-detail">
        <summary>
          <IconInfo size={14} title="What PI looked up" />
        </summary>
        <ul className="wf-list">
          {calls.map((c, i) => (
            <li key={i}>
              <span>{appDisplayName(c.app)}</span>
              <span className="what">{humanTool(c.base)}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

/* ── elicitation ─────────────────────────────────────────────────── */

/** Option rows for `offer_choices`. A pick is sent as an ordinary message. */
function Choices({
  ask,
  answered,
  onReply,
}: {
  ask: ChoicesAsk;
  answered: boolean;
  onReply: (text: string) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [other, setOther] = useState("");

  function toggle(label: string) {
    setPicked((prev) =>
      prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]
    );
  }

  return (
    <div className="choices">
      <p className="ask">{ask.question}</p>
      <ul className="choice-list">
        {ask.options.map((o) => {
          const on = picked.includes(o.label);
          return (
            <li key={o.label}>
              <button
                type="button"
                className={`choice-row${on ? " picked" : ""}`}
                aria-pressed={ask.multi ? on : undefined}
                disabled={answered}
                onClick={() => (ask.multi ? toggle(o.label) : onReply(o.label))}
              >
                <span className="lines">
                  <span className="what">{o.label}</span>
                  {o.detail && <span className="aside">{o.detail}</span>}
                </span>
                {ask.multi && <IconCheck size={16} className="icon tick" />}
              </button>
            </li>
          );
        })}
      </ul>
      {ask.allowOther && !answered && (
        <form
          className="choice-other"
          onSubmit={(e) => {
            e.preventDefault();
            const text = other.trim();
            if (text) onReply(text);
          }}
        >
          <input
            value={other}
            onChange={(e) => setOther(e.target.value)}
            placeholder="something else…"
            aria-label="Answer in your own words"
          />
          <button className="go" type="submit" disabled={!other.trim()}>
            <IconArrowUp size={15} title="Send this instead" />
          </button>
        </form>
      )}
      {ask.multi && !answered && (
        <button
          className="btn btn-fill btn-sm confirm"
          disabled={picked.length === 0}
          onClick={() => onReply(picked.join(", "))}
        >
          {picked.length > 1 ? "those are my picks" : "that’s my pick"}
        </button>
      )}
      {answered && <p className="answered">answered</p>}
    </div>
  );
}

/** The consent card for `request_app`: PI needs a TigerApp that's switched off. */
function Consent({
  request,
  settled,
  alreadyOn,
  halfGranted,
  onGrant,
  onDecline,
}: {
  request: AppRequest;
  settled: boolean;
  alreadyOn: boolean;
  /** Switched on, but Google never finished handing the calendar over. */
  halfGranted: boolean;
  onGrant: (app: AppKey) => void;
  onDecline: () => void;
}) {
  const app = PI_APPS.find((a) => a.key === request.app);
  if (!app) return null;
  // The calendar is the one app a switch can't finish on its own.
  const needsGoogle = request.app === "gcal";
  return (
    <div
      className={`consent-card${settled ? " settled" : ""}`}
      style={
        { "--app-color": APP_INK[request.app] } as React.CSSProperties
      }
    >
      <img className="mark" src={app.logo} alt="" />
      <div className="body">
        <p className="title">
          {alreadyOn
            ? `${app.name} is on`
            : halfGranted
              ? `${app.name} still needs Google`
              : `Turn on ${app.name}?`}
        </p>
        {!settled && (
          <p className="why">
            {halfGranted ? (
              <>
                It&rsquo;s switched on here, but Google hasn&rsquo;t handed the
                calendar over yet. That last step lives in My apps.
              </>
            ) : (
              <>
                PI needs this to {request.reason || `use ${app.name}`}.{" "}
                {needsGoogle
                  ? "Google has to say yes too, so this opens My apps."
                  : "You can switch it off anytime in the app library."}
              </>
            )}
          </p>
        )}
      </div>
      {!settled && (
        <div className="acts">
          <button className="btn btn-ghost btn-sm" onClick={onDecline}>
            not now
          </button>
          <button
            className="btn btn-fill btn-sm"
            onClick={() => onGrant(request.app)}
          >
            {halfGranted
              ? "finish in My apps"
              : needsGoogle
                ? "set it up"
                : "turn on"}
          </button>
        </div>
      )}
    </div>
  );
}
