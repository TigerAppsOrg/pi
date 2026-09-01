import { useAgent } from "agents/react";
import { useCallback, useMemo, useRef, useState } from "react";
import type { AppKey, PiSettings } from "../../shared/apps";
import { reportUnauthorized, userInstance } from "./auth";

export type DeskState = {
  settings: PiSettings | null;
  appErrors: Partial<Record<AppKey, string>>;
  authUrls?: Partial<Record<AppKey, string>>;
  gcalReady?: boolean;
};

export type McpServersSnapshot = {
  servers: Record<
    string,
    { name: string; server_url: string; state: string; error: string | null }
  >;
};

/** How long a desk round-trip may take before a page gives up on it. */
const CALL_TIMEOUT_MS = 15_000;

/**
 * `agent.ready` resolves on connect and is replaced (never rejected) on every
 * socket close, so awaiting it while the Worker is unreachable hangs forever.
 * Racing it against a clock is what lets pages reach their error state.
 */
function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    work.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timed out`)),
        CALL_TIMEOUT_MS
      );
    }),
  ]);
}

/**
 * A per-user "desk" agent instance shared by the planner, agenda, and apps
 * pages: one place that holds MCP connections outside any single chat.
 */
export function useDesk(settings: PiSettings) {
  const [deskState, setDeskState] = useState<DeskState | null>(null);
  const [mcp, setMcp] = useState<McpServersSnapshot | null>(null);
  /** Whether this outage already asked the shell to re-check the session. */
  const askedWhoRef = useRef(false);

  const agent = useAgent({
    agent: "pi",
    name: userInstance(settings.netid, "desk"),
    onStateUpdate: (state: DeskState) => setDeskState(state),
    onMcpUpdate: (snapshot) => setMcp(snapshot as McpServersSnapshot),
    // A lapsed session 401s the socket upgrade, which the browser reports as a
    // plain abnormal close. Without this the page just times out into "try
    // again" forever; the shell re-checks the session and offers a sign-in.
    // Once per outage — the socket retries, and each failure calls this.
    onConnectionError: () => {
      if (askedWhoRef.current) return;
      askedWhoRef.current = true;
      reportUnauthorized();
    },
    onOpen: () => {
      askedWhoRef.current = false;
    },
  });

  const settingsHash = useMemo(() => JSON.stringify(settings), [settings]);
  const appliedRef = useRef<string | null>(null);
  const setupRef = useRef<{ hash: string; work: Promise<void> } | null>(null);
  const failureRef = useRef<{ hash: string; at: number; err: unknown } | null>(
    null
  );
  // Every tool call on the desk opens MCP and tears it back down when it
  // returns (the Durable Object can only hibernate with nothing open), so two
  // overlapping calls would have the first one's teardown cut the second one
  // off mid-flight. Pages fire their loads together; this chain hands them to
  // the server one at a time.
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());

  const push = useCallback(
    async (next: PiSettings): Promise<void> => {
      const hash = JSON.stringify(next);
      await withTimeout(agent.ready, "the desk");
      await withTimeout(agent.call("setup", [next]), "saving your apps");
      appliedRef.current = hash;
    },
    [agent]
  );

  /**
   * One push per distinct settings payload, however many callers ask at once:
   * a toggle on My apps and the effect that reacts to it must not both send it.
   */
  const startPush = useCallback(
    (next: PiSettings): Promise<void> => {
      const hash = JSON.stringify(next);
      const inFlight = setupRef.current;
      if (inFlight?.hash === hash) return inFlight.work;
      // A desk that just failed is still failing: without this, four cards
      // waiting their turn each pay the full timeout, and the last one takes
      // a minute to admit it. Short enough that a human retry gets a real try.
      const failed = failureRef.current;
      if (failed && failed.hash === hash && Date.now() - failed.at < 3000) {
        return Promise.reject(failed.err);
      }
      const entry = {
        hash,
        work: push(next)
          .then(
            () => {
              failureRef.current = null;
            },
            (err: unknown) => {
              failureRef.current = { hash, at: Date.now(), err };
              throw err;
            }
          )
          .finally(() => {
            if (setupRef.current === entry) setupRef.current = null;
          }),
      };
      setupRef.current = entry;
      return entry.work;
    },
    [push]
  );

  const ensureSetup = useCallback((): Promise<void> => {
    if (appliedRef.current === settingsHash) return Promise.resolve();
    return startPush(settings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startPush, settingsHash]);

  /** Push a settings change the student just made. Always a real attempt. */
  const pushSettings = useCallback(
    (next: PiSettings): Promise<void> => {
      failureRef.current = null;
      return startPush(next);
    },
    [startPush]
  );

  const callApp = useCallback(
    (
      app: AppKey,
      tool: string,
      args: Record<string, unknown>
    ): Promise<unknown> => {
      const run = queueRef.current.then(async () => {
        await ensureSetup();
        return withTimeout(
          agent.call("callAppTool", [app, tool, args]),
          tool
        );
      });
      // Keep the queue moving after a failure, and don't let the copy we hold
      // for sequencing surface as an unhandled rejection.
      queueRef.current = run.catch(() => undefined);
      return run;
    },
    [agent, ensureSetup]
  );

  return {
    agent,
    deskState,
    mcp,
    ensureSetup,
    pushSettings,
    callApp,
    settingsHash,
  };
}

/** Machine text kept for a title attribute, never for the page itself. */
export function rawError(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err ?? "");
  return text.length > 300 ? `${text.slice(0, 297)}...` : text;
}

/**
 * Turns a thrown MCP/transport error into something a student can act on.
 * Pair it with `title={rawError(err)}` so the machine text stays available
 * without being printed in PI's handwriting.
 *
 * States the problem and stops: every call site draws a "Try again" button
 * beside it, and a sentence ending in "Try again." next to that button reads
 * as a stutter, three times over on the agenda.
 */
export function friendlyError(err: unknown, subject = "that"): string {
  const text = rawError(err).toLowerCase();
  if (text.includes("switched off")) {
    return `${subject} is switched off right now.`;
  }
  if (text.includes("timed out") || text.includes("timeout")) {
    return `${subject} is taking longer than it should.`;
  }
  if (
    text.includes("not configured") ||
    text.includes("isn't configured") ||
    text.includes("not set up")
  ) {
    return "That connection isn't set up on our side yet.";
  }
  if (
    text.includes("401") ||
    text.includes("403") ||
    text.includes("unauthor") ||
    text.includes("consent") ||
    text.includes("token")
  ) {
    return `${subject} needs your permission again before PI can read it.`;
  }
  if (text.includes("not connected") || text.includes("connect")) {
    return `PI couldn't reach ${subject}.`;
  }
  return `PI couldn't get ${subject} just now.`;
}
