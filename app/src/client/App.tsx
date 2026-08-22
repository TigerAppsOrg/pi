import { Suspense, useCallback, useEffect, useState } from "react";
import { Sidebar, type Route } from "./components/Sidebar";
import { newChatId, useChats, useSettings } from "./lib/store";
import { AgendaPage } from "./pages/AgendaPage";
import { AppsPage } from "./pages/AppsPage";
import { ChatPage } from "./pages/ChatPage";
import { PlannerPage } from "./pages/PlannerPage";

function parseRoute(pathname: string): Route {
  const chat = pathname.match(/^\/chat\/([\w-]+)$/);
  if (chat) return { page: "chat", chatId: chat[1] };
  if (pathname === "/planner") return { page: "planner" };
  if (pathname === "/agenda") return { page: "agenda" };
  if (pathname === "/apps") return { page: "apps" };
  return { page: "chat", chatId: null };
}

export function App() {
  const [route, setRoute] = useState<Route>(() =>
    parseRoute(location.pathname)
  );
  const [draftId, setDraftId] = useState(() => newChatId());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const settings = useSettings();
  const chats = useChats();

  const navigate = useCallback((path: string, replace = false) => {
    if (replace) history.replaceState(null, "", path);
    else history.pushState(null, "", path);
    const next = parseRoute(path);
    // A fresh visit to "/" starts a fresh draft conversation.
    if (next.page === "chat" && next.chatId === null && !replace) {
      setDraftId(newChatId());
    }
    setRoute(next);
    setSidebarOpen(false);
  }, []);

  useEffect(() => {
    const onPop = () => setRoute(parseRoute(location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const chatId = route.page === "chat" ? (route.chatId ?? draftId) : null;

  return (
    <div className="shell">
      {sidebarOpen && (
        <div className="scrim" onClick={() => setSidebarOpen(false)} />
      )}
      <Sidebar
        route={route}
        open={sidebarOpen}
        navigate={navigate}
        chats={chats}
        settings={settings}
      />
      <div className="main">
        <div className="topbar">
          <button
            aria-label="Menu"
            onClick={() => setSidebarOpen(true)}
            style={{ fontSize: 20 }}
          >
            ☰
          </button>
          <strong>PI</strong>
        </div>
        {route.page === "chat" && chatId && (
          <Suspense
            fallback={
              <div className="empty-hand" style={{ paddingTop: "20vh" }}>
                opening your desk…
              </div>
            }
          >
            <ChatPage
              key={chatId}
              chatId={chatId}
              isDraft={route.chatId === null}
              settings={settings}
              navigate={navigate}
            />
          </Suspense>
        )}
        {route.page === "planner" && (
          <PlannerPage settings={settings} navigate={navigate} />
        )}
        {route.page === "agenda" && (
          <AgendaPage settings={settings} navigate={navigate} />
        )}
        {route.page === "apps" && <AppsPage settings={settings} />}
      </div>
    </div>
  );
}
