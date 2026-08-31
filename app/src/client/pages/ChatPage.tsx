import { useAgentChat } from "@cloudflare/think/react";
import { AgentClient } from "agents/client";
import { useAgent } from "agents/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { UIMessage } from "ai";
import { PI_MODELS, type PiSettings } from "../../shared/apps";
import { Composer } from "../components/Composer";
import { Markdown } from "../components/Markdown";
import { ToolRender } from "../components/ToolCards";
import { userInstance, type Identity } from "../lib/auth";
import { newChatId, savePrefs, upsertChat, useChats } from "../lib/store";
import { parseToolPart } from "../lib/tools";

const SUGGESTIONS = [
  "What does my fall schedule look like?",
  "Find me a highly-rated LA distribution course with no Friday classes",
  "Which COS courses are trending this semester?",
  "Does anything in my schedule conflict?",
];

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

export function ChatPage({
  chatId,
  isDraft,
  identity,
  settings,
  navigate,
}: {
  chatId: string;
  /** True when this chat hasn't been sent to yet (the "/" home state). */
  isDraft: boolean;
  identity: Identity;
  settings: PiSettings;
  navigate: (path: string, replace?: boolean) => void;
}) {
  const agent = useAgent({ agent: "pi", name: userInstance(identity.netid, chatId) });
  const chat = useAgentChat({ agent });
  const { messages, sendMessage, status, stop, regenerate, connectionError } =
    chat;
  const chats = useChats(identity.netid);

  const scrollRef = useRef<HTMLDivElement>(null);
  const settingsHash = useMemo(() => JSON.stringify(settings), [settings]);
  const appliedRef = useRef<string | null>(null);
  const startedRef = useRef(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);

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
    if (appliedRef.current === settingsHash) return;
    appliedRef.current = settingsHash;
    try {
      await agent.ready;
      await agent.call("setup", [settings]);
    } catch (err) {
      console.warn("PI setup failed", err);
      appliedRef.current = null;
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

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  function send(text: string) {
    startedRef.current = true;
    if (isDraft) navigate(`/chat/${chatId}`, true);
    upsertChat(identity.netid, {
      id: chatId,
      title: firstTitle(messages) ?? text.slice(0, 48),
      at: Date.now(),
    });
    sendChain.current = sendChain.current.then(async () => {
      // The first message of a chat needs settings on the server; bound the
      // wait so a slow push can never swallow a message silently.
      await Promise.race([
        ensureSetup(),
        new Promise((resolve) => setTimeout(resolve, 4000)),
      ]);
      void sendMessage({ text });
    });
  }

  /** Copy history up to `endIndex` (exclusive) into a fresh chat. */
  async function branch(endIndex: number, draftText?: string): Promise<void> {
    const slice = messages.slice(0, endIndex);
    const id = newChatId();
    setBusyAction("branch");
    try {
      const client = new AgentClient({
        agent: "pi",
        name: userInstance(identity.netid, id),
        host: location.host,
      });
      await client.ready;
      if (slice.length > 0) await client.call("importHistory", [slice]);
      await client.call("setup", [settings]);
      client.close();
      const current = chats.find((c) => c.id === chatId);
      upsertChat(identity.netid, {
        id,
        title: `⑂ ${current?.title ?? firstTitle(messages) ?? "fork"}`.slice(
          0,
          48
        ),
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
    } finally {
      setBusyAction(null);
    }
  }

  const busy = status === "submitted" || status === "streaming";
  const empty = messages.length === 0;
  const name = (identity.name.split(" ")[0] || identity.netid).toLowerCase();
  const lastAssistantId = [...messages]
    .reverse()
    .find((m) => m.role === "assistant")?.id;

  const modelSwitch = (
    <select
      className="model-select"
      aria-label="Model"
      value={settings.model}
      onChange={(e) =>
        savePrefs(identity.netid, {
          apps: settings.apps,
          model: e.target.value as PiSettings["model"],
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
        <div className="conn-strip">
          Connection hiccup — retrying. ({connectionError.reason || "socket closed"})
        </div>
      )}
      <div className="chat-scroll" ref={scrollRef}>
        <div className="chat-column">
          {empty ? (
            <div className="hello">
              <h1>
                Hello <span className="name swipe">{name}</span>,
              </h1>
              <p>how can I help you today?</p>
              <div className="prompts">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    className="prompt-chip"
                    onClick={() => void send(s)}
                  >
                    <span className="pen" aria-hidden>
                      ↳
                    </span>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => (
              <Turn
                key={m.id}
                message={m}
                actionsDisabled={busy || busyAction != null}
                isLastAssistant={m.id === lastAssistantId}
                onRewind={
                  m.role === "user"
                    ? () => void branch(i, messageText(m))
                    : undefined
                }
                onFork={
                  m.role === "assistant"
                    ? () => void branch(i + 1)
                    : undefined
                }
                onRegenerate={
                  m.role === "assistant" && m.id === lastAssistantId
                    ? () => void regenerate()
                    : undefined
                }
              />
            ))
          )}
          {busy && lastIsUser(messages) && (
            <div className="writing">
              <span className="nib" /> pi is writing…
            </div>
          )}
          {busyAction === "branch" && (
            <div className="writing">
              <span className="nib" /> copying this conversation…
            </div>
          )}
        </div>
      </div>
      <Composer
        onSend={(t) => void send(t)}
        onStop={stop}
        busy={busy}
        placeholder="Ask about courses, schedules, ratings, your degree…"
        initialText={draft}
        accessory={modelSwitch}
      />
    </>
  );
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

function Turn({
  message,
  actionsDisabled,
  isLastAssistant,
  onRewind,
  onFork,
  onRegenerate,
}: {
  message: UIMessage;
  actionsDisabled: boolean;
  isLastAssistant: boolean;
  onRewind?: () => void;
  onFork?: () => void;
  onRegenerate?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  function copy() {
    void navigator.clipboard.writeText(messageText(message)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const actions = (
    <div className="msg-actions" role="toolbar" aria-label="Message actions">
      <button onClick={copy} title="Copy text" disabled={actionsDisabled}>
        {copied ? "✓ copied" : "⧉ copy"}
      </button>
      {onRewind && (
        <button
          onClick={onRewind}
          title="Branch a new chat from just before this message, with it back in the composer"
          disabled={actionsDisabled}
        >
          ↺ rewind
        </button>
      )}
      {onFork && (
        <button
          onClick={onFork}
          title="Branch a new chat that continues from this point"
          disabled={actionsDisabled}
        >
          ⑂ fork
        </button>
      )}
      {onRegenerate && isLastAssistant && (
        <button
          onClick={onRegenerate}
          title="Ask PI to answer again"
          disabled={actionsDisabled}
        >
          ↻ retry
        </button>
      )}
    </div>
  );

  if (message.role === "user") {
    return (
      <div className="turn user">
        <div>
          <div className="bubble">{messageText(message)}</div>
          {actions}
        </div>
      </div>
    );
  }

  return (
    <div className="turn assistant">
      {coalesceParts(message.parts).map((part, i) => {
        if (part.type === "text") {
          return part.text.trim() ? <Markdown key={i} text={part.text} /> : null;
        }
        if (part.type === "reasoning") {
          const text = (part as { text?: string }).text?.trim();
          if (!text) return null;
          return (
            <details key={i} className="reasoning">
              <summary>margin notes</summary>
              <div className="body">{text}</div>
            </details>
          );
        }
        const tool = parseToolPart(part);
        if (tool) return <ToolRender key={i} view={tool} />;
        return null;
      })}
      {messageText(message) !== "" && actions}
    </div>
  );
}
