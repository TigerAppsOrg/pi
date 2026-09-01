import { AgentClient } from "agents/client";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { userInstance, type Identity } from "../lib/auth";
import {
  formatChatTime,
  GENERAL_CHAT_ID,
  GENERAL_CHAT_TITLE,
  removeChat,
  toggleStar,
  type ChatMeta,
} from "../lib/store";
import {
  IconCalendar,
  IconCheck,
  IconChevron,
  IconGrid,
  IconPen,
  IconPlus,
  IconSearch,
  IconStar,
  IconX,
  PiMark,
} from "./Icons";

export type Route =
  | { page: "chat"; chatId: string | null }
  | { page: "planner" }
  | { page: "agenda" }
  | { page: "apps" }
  | { page: "notfound" };

type NavItem = {
  page: Route["page"];
  label: string;
  href: string;
  Icon: typeof IconPen;
};

const NAV: NavItem[] = [
  { page: "chat", label: "chats", href: "/", Icon: IconPen },
  { page: "apps", label: "my apps", href: "/apps", Icon: IconGrid },
  { page: "agenda", label: "agenda", href: "/agenda", Icon: IconCheck },
  { page: "planner", label: "planner", href: "/planner", Icon: IconCalendar },
];

/** Recent stays short; the rest hide behind "browse all chats". */
const RECENT_CAP = 8;
/** Below this the list is short enough to read without a filter. */
const SEARCH_FROM = 5;

/**
 * A click that should stay in the SPA. Modifier and middle clicks fall
 * through to the browser so cmd-click opens a chat in a new tab.
 */
function inAppClick(
  e: MouseEvent<HTMLAnchorElement>,
  go: () => void
): void {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
  e.preventDefault();
  go();
}

/**
 * Ask a chat's Durable Object to drop its transcript, so "delete" means the
 * conversation is gone and not merely hidden. The socket opens for one frame
 * and closes again — nothing is held across idle time.
 */
function forgetTranscript(netid: string, chatId: string): void {
  try {
    const client = new AgentClient({
      agent: "pi",
      name: userInstance(netid, chatId),
      host: location.host,
    });
    void client.ready
      .then(() => {
        client.send(JSON.stringify({ type: "cf_agent_chat_clear" }));
        setTimeout(() => client.close(), 500);
      })
      .catch(() => client.close());
  } catch (err) {
    // The row goes either way; a stranded transcript is not worth a dead end.
    console.warn("could not clear the transcript", err);
  }
}

export function Sidebar({
  route,
  open,
  onClose,
  navigate,
  chats,
  identity,
  appCount,
}: {
  route: Route;
  open: boolean;
  onClose: () => void;
  navigate: (path: string) => void;
  chats: ChatMeta[];
  identity: Identity;
  appCount: number;
}) {
  const activeChatId = route.page === "chat" ? route.chatId : null;
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Opening the drawer on a phone should land the focus inside it.
  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  // "delete?" is a question, not a mode: it takes the focus so the answer can
  // be a keystroke, and it forgets itself if left alone.
  useEffect(() => {
    if (!confirmId) return;
    confirmRef.current?.focus();
    const t = setTimeout(() => setConfirmId(null), 5000);
    return () => clearTimeout(t);
  }, [confirmId]);

  const q = query.trim().toLowerCase();
  const listed = chats.filter(
    (c) =>
      c.id !== GENERAL_CHAT_ID &&
      (q === "" || (c.title || "").toLowerCase().includes(q))
  );
  const starred = listed.filter((c) => c.starred);
  const recent = listed.filter((c) => !c.starred);
  const searching = q !== "";
  const shown = searching || showAll ? recent : recent.slice(0, RECENT_CAP);
  const hidden = recent.length - shown.length;
  const general = chats.find((c) => c.id === GENERAL_CHAT_ID);

  function deleteChat(chat: ChatMeta) {
    setConfirmId(null);
    forgetTranscript(identity.netid, chat.id);
    removeChat(identity.netid, chat.id);
    if (chat.id === activeChatId) navigate("/");
  }

  function row(chat: ChatMeta) {
    const active = chat.id === activeChatId;
    const title = chat.title || "untitled scrap";
    return (
      <li className="chat-item" key={chat.id}>
        <a
          className={active ? "chat-row active" : "chat-row"}
          href={`/chat/${chat.id}`}
          aria-current={active ? "page" : undefined}
          onClick={(e) => inAppClick(e, () => navigate(`/chat/${chat.id}`))}
        >
          <span className="title">{title}</span>
          <span className="timestamp">{formatChatTime(chat.at)}</span>
        </a>
        <span className="row-actions">
          <button
            className={chat.starred ? "row-btn starred" : "row-btn"}
            aria-pressed={!!chat.starred}
            aria-label={`Star ${title}`}
            onClick={() => toggleStar(identity.netid, chat.id)}
          >
            <IconStar size={14} />
          </button>
          {confirmId === chat.id ? (
            <button
              className="row-btn confirm"
              ref={confirmRef}
              onKeyDown={(e) => e.key === "Escape" && setConfirmId(null)}
              onClick={() => deleteChat(chat)}
            >
              delete?
            </button>
          ) : (
            <button
              className="row-btn"
              aria-label={`Delete ${title}`}
              onClick={() => setConfirmId(chat.id)}
            >
              <IconX size={14} />
            </button>
          )}
        </span>
      </li>
    );
  }

  return (
    <nav
      className={open ? "sidebar open" : "sidebar"}
      aria-label="PI sections"
      id="pi-sidebar"
    >
      <div className="wordmark">
        <span className="pi-lozenge">
          <PiMark size={16} />
        </span>
        <div>
          <div className="name">PI</div>
          <div className="sub">by TigerApps</div>
        </div>
        <button
          className="drawer-close"
          ref={closeRef}
          onClick={onClose}
          aria-label="Close PI's sections"
        >
          <IconX size={18} />
        </button>
      </div>

      <a
        className="new-chat"
        href="/"
        onClick={(e) => inAppClick(e, () => navigate("/"))}
      >
        <span className="plus-dot" aria-hidden="true">
          <IconPlus size={15} />
        </span>
        New chat
      </a>

      <div className="nav-tabs">
        {NAV.map(({ page, label, href, Icon }) => {
          const active = route.page === page;
          return (
            <a
              key={page}
              className={active ? "nav-tab active" : "nav-tab"}
              href={href}
              aria-current={active ? "page" : undefined}
              onClick={(e) => inAppClick(e, () => navigate(href))}
            >
              <Icon size={16} />
              <span className="nav-label">{label}</span>
            </a>
          );
        })}
      </div>
      <hr className="hand-rule" aria-hidden="true" />

      <a
        className={
          activeChatId === GENERAL_CHAT_ID ? "pinned-chat active" : "pinned-chat"
        }
        href={`/chat/${GENERAL_CHAT_ID}`}
        aria-current={activeChatId === GENERAL_CHAT_ID ? "page" : undefined}
        onClick={(e) =>
          inAppClick(e, () => navigate(`/chat/${GENERAL_CHAT_ID}`))
        }
      >
        <span className="pi-lozenge" aria-hidden="true">
          <PiMark size={13} />
        </span>
        <span className="title">{GENERAL_CHAT_TITLE}</span>
        {general ? (
          <span className="timestamp">{formatChatTime(general.at)}</span>
        ) : (
          <span className="timestamp">always here</span>
        )}
      </a>

      {chats.length >= SEARCH_FROM && (
        <div className="chat-search">
          <IconSearch size={15} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your chats by title"
            aria-label="Search your chats by title"
          />
        </div>
      )}

      <div className="chat-list">
        {chats.length === 0 && (
          <p className="list-empty">still a blank page. ask PI something.</p>
        )}
        {chats.length > 0 && listed.length === 0 && searching && (
          <p className="list-empty">nothing by that name.</p>
        )}

        {starred.length > 0 && (
          <section className="chat-sec" aria-labelledby="sec-starred">
            <h2 className="chat-list-label" id="sec-starred">
              <IconStar size={13} /> starred
            </h2>
            <ul className="chat-rows">{starred.map(row)}</ul>
          </section>
        )}

        {shown.length > 0 && (
          <section className="chat-sec" aria-labelledby="sec-recent">
            <h2 className="chat-list-label" id="sec-recent">
              recent
            </h2>
            <ul className="chat-rows">{shown.map(row)}</ul>
          </section>
        )}

        {hidden > 0 && (
          <button className="browse-all" onClick={() => setShowAll(true)}>
            <IconChevron size={13} />
            browse all {recent.length} chats
          </button>
        )}
        {showAll && !searching && recent.length > RECENT_CAP && (
          <button className="browse-all" onClick={() => setShowAll(false)}>
            <IconChevron size={13} className="icon up" />
            show fewer
          </button>
        )}

        <section className="ws" aria-labelledby="sec-ws">
          <h2 className="chat-list-label" id="sec-ws">
            workspaces <span className="soon-chip">soon</span>
          </h2>
          <p className="ws-row">
            <IconPlus size={13} /> new workspace
          </p>
          <p className="ws-note">
            one shared desk for a precept or a club, with its chats in it.
          </p>
        </section>
      </div>

      <div className="sidebar-foot">
        <a
          className="identity-chip"
          href="/apps"
          onClick={(e) => inAppClick(e, () => navigate("/apps"))}
        >
          <span className="avatar" aria-hidden="true">
            {identity.netid.slice(0, 1).toUpperCase()}
          </span>
          <span className="who">
            <span className="netid">{identity.netid}</span>
            <span className="hint">
              {appCount === 0
                ? "no apps switched on"
                : `${appCount} app${appCount === 1 ? "" : "s"} switched on`}
            </span>
          </span>
        </a>
        <p className="colophon">
          <a href="https://tigerapps.org" target="_blank" rel="noreferrer">
            made by TigerApps
          </a>
          <span className="dot" aria-hidden="true" />
          <a href="/apps" onClick={(e) => inAppClick(e, () => navigate("/apps"))}>
            what PI reads
          </a>
        </p>
      </div>
    </nav>
  );
}
