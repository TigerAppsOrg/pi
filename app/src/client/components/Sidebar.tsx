import type { PiSettings } from "../../shared/apps";
import { removeChat, type ChatMeta } from "../lib/store";

export type Route =
  | { page: "chat"; chatId: string | null }
  | { page: "planner" }
  | { page: "agenda" }
  | { page: "apps" };

const NAV: Array<{ page: Route["page"]; label: string; glyph: string }> = [
  { page: "chat", label: "Chat", glyph: "✎" },
  { page: "planner", label: "Planner", glyph: "▦" },
  { page: "agenda", label: "Agenda", glyph: "☑" },
  { page: "apps", label: "My apps", glyph: "✦" },
];

export function Sidebar({
  route,
  open,
  navigate,
  chats,
  settings,
}: {
  route: Route;
  open: boolean;
  navigate: (path: string) => void;
  chats: ChatMeta[];
  settings: PiSettings;
}) {
  const activeChatId = route.page === "chat" ? route.chatId : null;

  return (
    <nav className={open ? "sidebar open" : "sidebar"} aria-label="PI">
      <div className="wordmark">
        <div className="mark" aria-hidden>
          <img src="/logos/tigerapps.png" alt="" />
          <span className="pi-badge">π</span>
        </div>
        <div>
          <div className="name">PI</div>
          <div className="sub">by TigerApps</div>
        </div>
      </div>

      <button className="new-chat" onClick={() => navigate("/")}>
        <span aria-hidden>＋</span> New chat
      </button>

      {NAV.map((item) => (
        <button
          key={item.page}
          className={route.page === item.page ? "nav-item active" : "nav-item"}
          onClick={() =>
            navigate(item.page === "chat" ? "/" : `/${item.page}`)
          }
        >
          <span className="nav-icon" aria-hidden>
            {item.glyph}
          </span>
          <span className="nav-label">{item.label}</span>
        </button>
      ))}

      <div className="chat-list">
        <div className="chat-list-label">recent chats</div>
        {chats.length === 0 && (
          <div
            className="chat-list-label"
            style={{ fontFamily: "var(--sans)", fontSize: 12 }}
          >
            Nothing yet — ask PI something.
          </div>
        )}
        {chats.map((c) => (
          <div
            key={c.id}
            className={c.id === activeChatId ? "chat-row active" : "chat-row"}
            role="button"
            tabIndex={0}
            onClick={() => navigate(`/chat/${c.id}`)}
            onKeyDown={(e) => e.key === "Enter" && navigate(`/chat/${c.id}`)}
          >
            <span className="title">{c.title || "Untitled"}</span>
            <button
              className="del"
              aria-label={`Delete ${c.title}`}
              onClick={(e) => {
                e.stopPropagation();
                removeChat(c.id);
                if (c.id === activeChatId) navigate("/");
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <button className="identity-chip" onClick={() => navigate("/apps")}>
        <span className="avatar" aria-hidden>
          {(settings.netid || "?").slice(0, 1).toUpperCase()}
        </span>
        <span className="who">
          <div className="netid">{settings.netid || "no netid yet"}</div>
          <div className="hint">
            {settings.netid
              ? `${settings.apps.length} app${settings.apps.length === 1 ? "" : "s"} connected`
              : "set one on My apps"}
          </div>
        </span>
      </button>
    </nav>
  );
}
