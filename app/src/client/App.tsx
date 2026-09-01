import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { IconMenu, PiMark } from "./components/Icons";
import { Sidebar, type Route } from "./components/Sidebar";
import {
  signIn,
  takeReturnPath,
  useIdentity,
  type Identity,
} from "./lib/auth";
import {
  ensureChat,
  GENERAL_CHAT_ID,
  GENERAL_CHAT_TITLE,
  newChatId,
  toSettings,
  useChats,
  usePrefs,
} from "./lib/store";
import { SignInPage } from "./pages/SignInPage";
import "./styles/shell.css";

// Each destination is its own chunk: the sign-in page and the shell are the
// only things a first visit has to download.
const ChatPage = lazy(() =>
  import("./pages/ChatPage").then((m) => ({ default: m.ChatPage }))
);
const PlannerPage = lazy(() =>
  import("./pages/PlannerPage").then((m) => ({ default: m.PlannerPage }))
);
const AgendaPage = lazy(() =>
  import("./pages/AgendaPage").then((m) => ({ default: m.AgendaPage }))
);
const AppsPage = lazy(() =>
  import("./pages/AppsPage").then((m) => ({ default: m.AppsPage }))
);

const BASE_TITLE = "PI, your Princeton desk";

const PAGE_TITLES: Record<string, string> = {
  planner: "Planner",
  agenda: "Agenda",
  apps: "My apps",
  notfound: "Page not found",
};

function parseRoute(pathname: string): Route {
  const chat = pathname.match(/^\/chat\/([\w-]+)$/);
  if (chat) return { page: "chat", chatId: chat[1] };
  if (pathname === "/") return { page: "chat", chatId: null };
  if (pathname === "/planner") return { page: "planner" };
  if (pathname === "/agenda") return { page: "agenda" };
  if (pathname === "/apps") return { page: "apps" };
  return { page: "notfound" };
}

export function App() {
  const { auth, revalidate } = useIdentity();

  if (auth.status === "loading") return <BootShell />;
  if (auth.status === "unreachable") {
    return <SignInPage unreachable onRetry={revalidate} />;
  }
  if (auth.status === "anon") return <SignInPage />;
  return (
    <Desk identity={auth.identity} lapsed={auth.status === "expired"} />
  );
}

function Desk({
  identity,
  lapsed,
}: {
  identity: Identity;
  /** The session ran out while this tab was open. */
  lapsed: boolean;
}) {
  const [route, setRoute] = useState<Route>(() =>
    parseRoute(location.pathname)
  );
  const [draftId, setDraftId] = useState(() => newChatId());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const prefs = usePrefs(identity.netid);
  const chats = useChats(identity.netid);
  const narrow = useNarrow();
  const mainRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const takeFocus = useRef(false);
  const returnFocus = useRef(false);
  const settings = useMemo(
    () => toSettings(identity.netid, prefs),
    [identity.netid, prefs]
  );

  const navigate = useCallback((path: string, replace = false) => {
    if (replace) history.replaceState(null, "", path);
    else history.pushState(null, "", path);
    const next = parseRoute(path);
    // A fresh visit to "/" starts a fresh draft conversation.
    if (next.page === "chat" && next.chatId === null && !replace) {
      setDraftId(newChatId());
    }
    // A replace is the chat page pinning its own URL mid-send; that must never
    // pull focus out of the composer.
    if (!replace) takeFocus.current = true;
    setRoute(next);
    setSidebarOpen(false);
  }, []);

  // Dismissing the drawer hands focus back to the button that opened it. It
  // waits for the render because closing is also what lifts `inert` off main.
  const closeSidebar = useCallback(() => {
    returnFocus.current = true;
    setSidebarOpen(false);
  }, []);

  useEffect(() => {
    if (sidebarOpen || !returnFocus.current) return;
    returnFocus.current = false;
    menuRef.current?.focus();
  }, [sidebarOpen]);

  useEffect(() => {
    const onPop = () => setRoute(parseRoute(location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Sign-in always lands on "/", so replay the page the student asked for.
  useEffect(() => {
    const parked = takeReturnPath();
    if (parked && parked !== location.pathname + location.search) {
      navigate(parked, true);
    }
  }, [navigate]);

  useEffect(() => {
    if (!takeFocus.current) return;
    takeFocus.current = false;
    mainRef.current?.focus({ preventScroll: true });
  }, [route]);

  // The general chat is a constant, not a minted id; give it a row the first
  // time it's opened so it carries a real timestamp afterwards.
  useEffect(() => {
    if (route.page === "chat" && route.chatId === GENERAL_CHAT_ID) {
      ensureChat(identity.netid, {
        id: GENERAL_CHAT_ID,
        title: GENERAL_CHAT_TITLE,
        at: Date.now(),
      });
    }
  }, [route, identity.netid]);

  useEffect(() => {
    let head: string | null = null;
    if (route.page === "chat") {
      if (route.chatId === GENERAL_CHAT_ID) head = GENERAL_CHAT_TITLE;
      else if (route.chatId) {
        head = chats.find((c) => c.id === route.chatId)?.title || "Chat";
      }
    } else {
      head = PAGE_TITLES[route.page] ?? null;
    }
    document.title = head ? `${head} · PI` : BASE_TITLE;
  }, [route, chats]);

  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeSidebar();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sidebarOpen, closeSidebar]);

  useRouteWarmup();

  const chatId = route.page === "chat" ? (route.chatId ?? draftId) : null;

  return (
    <>
      <a className="skip-link" href="#desk-main">
        skip to the conversation
      </a>
      <div className="shell" inert={lapsed || undefined}>
        {sidebarOpen && (
          <button
            className="scrim"
            aria-label="Close PI's sections"
            onClick={closeSidebar}
          />
        )}
        <Sidebar
          route={route}
          open={sidebarOpen}
          onClose={closeSidebar}
          navigate={navigate}
          chats={chats}
          identity={identity}
          appCount={prefs.apps.length}
        />
        <main
          className="main"
          id="desk-main"
          ref={mainRef}
          tabIndex={-1}
          inert={(narrow && sidebarOpen) || undefined}
        >
          <header className="topbar">
            <button
              ref={menuRef}
              aria-label="Open PI's sections"
              aria-expanded={sidebarOpen}
              aria-controls="pi-sidebar"
              onClick={() => setSidebarOpen(true)}
            >
              <IconMenu size={20} />
            </button>
            <span className="pi-lozenge">
              <PiMark size={15} />
            </span>
            <strong>PI</strong>
          </header>
          {/* One destination failing keeps the sidebar alive, so the student
              can walk to another chat instead of reloading the world. The key
              clears the error as soon as they do. */}
          <ErrorBoundary key={`${route.page}:${chatId ?? ""}`} landmark={false}>
            {route.page === "chat" && chatId && (
              <Suspense fallback={<ChatSkeleton />}>
                <ChatPage
                  key={chatId}
                  chatId={chatId}
                  isDraft={route.chatId === null}
                  identity={identity}
                  settings={settings}
                  navigate={navigate}
                />
              </Suspense>
            )}
            {route.page === "planner" && (
              <Suspense fallback={<PageSkeleton label="the planner" />}>
                <PlannerPage settings={settings} navigate={navigate} />
              </Suspense>
            )}
            {route.page === "agenda" && (
              <Suspense fallback={<PageSkeleton label="today's agenda" />}>
                <AgendaPage settings={settings} navigate={navigate} />
              </Suspense>
            )}
            {route.page === "apps" && (
              <Suspense fallback={<PageSkeleton label="your apps" />}>
                <AppsPage identity={identity} settings={settings} />
              </Suspense>
            )}
            {route.page === "notfound" && <NotFound navigate={navigate} />}
          </ErrorBoundary>
        </main>
      </div>
      {lapsed && <SessionLapse />}
    </>
  );
}

/** True while the sidebar is a drawer rather than a column. */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(
    () => window.matchMedia("(max-width: 820px)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 820px)");
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches);
    setNarrow(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

/** Pull the other route chunks down once the desk is quiet. */
function useRouteWarmup(): void {
  useEffect(() => {
    const warm = () => {
      void import("./pages/ChatPage");
      void import("./pages/AgendaPage");
      void import("./pages/AppsPage");
      void import("./pages/PlannerPage");
    };
    const idle = (
      window as Window & {
        requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
        cancelIdleCallback?: (id: number) => void;
      }
    ).requestIdleCallback;
    if (!idle) {
      const t = window.setTimeout(warm, 2500);
      return () => clearTimeout(t);
    }
    const id = idle(warm, { timeout: 4000 });
    return () => window.cancelIdleCallback?.(id);
  }, []);
}

/**
 * The auth check's loading state. This is the same tree index.html paints
 * before the bundle lands, so React taking over changes nothing on screen.
 */
function BootShell() {
  return (
    <div className="shell boot-shell" aria-busy="true" aria-label="Opening PI">
      <div className="sidebar boot-sidebar" aria-hidden="true">
        <div className="boot-wordmark">
          <span className="pi-lozenge">
            <PiMark size={16} />
          </span>
          <span className="boot-bones">
            <span className="skel skel-line" />
            <span className="skel skel-line" />
          </span>
        </div>
        <div className="skel boot-newchat" />
        <div className="boot-rows">
          <span className="skel skel-line" />
          <span className="skel skel-line" />
          <span className="skel skel-line" />
          <span className="skel skel-line" />
        </div>
        <div className="boot-rows divided">
          <span className="skel skel-line" />
          <span className="skel skel-line" />
          <span className="skel skel-line" />
          <span className="skel skel-line" />
          <span className="skel skel-line" />
        </div>
      </div>
      <div className="main boot-main">
        <div className="boot-center">
          <span className="pi-lozenge pi-lozenge-lg">
            <PiMark size={30} />
          </span>
          <p className="boot-note">opening your desk…</p>
        </div>
      </div>
    </div>
  );
}

/** Chat-shaped placeholder: two turns and the composer already in place. */
function ChatSkeleton() {
  return (
    <div className="route-skel" aria-busy="true" aria-label="Opening this chat">
      <div className="chat-column">
        <div className="skel-turn mine">
          <span className="skel skel-line" />
        </div>
        <div className="skel-turn">
          <span className="skel skel-line" />
          <span className="skel skel-line" />
          <span className="skel skel-line" />
        </div>
      </div>
      <div className="skel skel-composer" />
    </div>
  );
}

function PageSkeleton({ label }: { label: string }) {
  return (
    <div className="route-skel" aria-busy="true" aria-label={`Opening ${label}`}>
      <div className="page-inner">
        <div className="skel skel-title" />
        <div className="skel skel-block" />
        <div className="skel skel-block" />
      </div>
    </div>
  );
}

function NotFound({
  navigate,
}: {
  navigate: (path: string, replace?: boolean) => void;
}) {
  function home(e: MouseEvent<HTMLAnchorElement>) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate("/");
  }
  return (
    <div className="page-miss">
      <div className="sticky-note">
        {/* Every other route heads its page; this one should too, so the
            outline isn't a hole for anyone skimming by heading. */}
        <h1 className="lead">nothing filed under that address.</h1>
        <p className="body">
          The link is either mistyped or points at a page PI used to have.
        </p>
      </div>
      <a className="btn btn-ink" href="/" onClick={home}>
        Back to chat
      </a>
    </div>
  );
}

/**
 * Sessions last a week and don't slide, so they do run out mid-tab. The desk
 * stays on screen behind this — nothing was lost, and signing back in returns
 * to the very same page.
 */
function SessionLapse() {
  const cta = useRef<HTMLButtonElement>(null);
  useEffect(() => cta.current?.focus(), []);
  return (
    <div
      className="lapse"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lapse-title"
    >
      <div className="lapse-card">
        <span className="pi-lozenge pi-lozenge-lg">
          <PiMark size={30} />
        </span>
        <h2 id="lapse-title">Your Princeton sign-in ran out.</h2>
        <p>
          Nothing is lost. Sign back in and PI puts you down on this same page.
        </p>
        <button className="btn btn-ink" ref={cta} onClick={() => signIn()}>
          Sign back in
        </button>
      </div>
    </div>
  );
}
