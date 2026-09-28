import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { EMPTY_WORKSPACES, type WorkspaceAction, type WorkspaceState } from "../../shared/workspaces";
import { reportUnauthorized } from "./auth";
import { ensureChat } from "./store";

type WorkspaceStore = {
  state: WorkspaceState;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  change: (action: WorkspaceAction) => Promise<WorkspaceState>;
};
const Context = createContext<WorkspaceStore | null>(null);

export function WorkspaceProvider({ netid, children }: { netid: string; children: ReactNode }) {
  const [state, setState] = useState(EMPTY_WORKSPACES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const alive = useRef(true);

  const request = useCallback((action?: WorkspaceAction): Promise<WorkspaceState> => {
    const job = queue.current.then(async () => {
      const res = await fetch("/api/workspaces", {
        method: action ? "POST" : "GET",
        headers: action ? { "content-type": "application/json" } : undefined,
        body: action ? JSON.stringify(action) : undefined,
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });
      if (res.status === 401) reportUnauthorized();
      const data = await res.json() as WorkspaceState & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not save your workspace. Try again.");
      if (!Array.isArray(data.workspaces) || !Array.isArray(data.chats)) throw new Error("Could not load your workspaces.");
      if (alive.current) {
        setState(data);
        setError(null);
        for (const chat of data.chats) ensureChat(netid, chat);
      }
      return data;
    });
    queue.current = job.catch((err) => {
      if (alive.current) setError(err instanceof Error ? err.message : "Could not reach your workspaces.");
    }).finally(() => { if (alive.current) setLoading(false); });
    return job;
  }, [netid]);

  const refresh = useCallback(async () => { try { await request(); } catch { /* shown by the store */ } }, [request]);
  useEffect(() => {
    alive.current = true;
    void refresh();
    const focus = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", focus);
    return () => { alive.current = false; window.removeEventListener("focus", focus); };
  }, [refresh]);

  return <Context.Provider value={{ state, loading, error, refresh, change: request }}>{children}</Context.Provider>;
}

export function useWorkspaces(): WorkspaceStore {
  const store = useContext(Context);
  if (!store) throw new Error("Workspaces require a signed-in desk.");
  return store;
}
