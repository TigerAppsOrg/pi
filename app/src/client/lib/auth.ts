import { useCallback, useEffect, useRef, useState } from "react";

export type Identity = {
  netid: string;
  name: string;
  email: string;
};

export type AuthState =
  | { status: "loading" }
  | { status: "anon" }
  /** /auth/me never answered — the Worker is down or the laptop is offline. */
  | { status: "unreachable" }
  | { status: "authed"; identity: Identity }
  /** Signed in when the tab opened; the session has since lapsed. */
  | { status: "expired"; identity: Identity };

/** Where signIn() parks the page the student was on, across the Entra hop. */
const RETURN_KEY = "pi:return-to";

/**
 * Anything holding an authenticated connection can announce a 401 here; the
 * shell re-checks the session and shows the sign-in-expired card rather than
 * leaving a dead composer on screen.
 */
const STALE_EVENT = "pi:unauthorized";

export function reportUnauthorized() {
  window.dispatchEvent(new Event(STALE_EVENT));
}

/** Don't hammer /auth/me on every tab focus. */
const RECHECK_AFTER_MS = 30_000;

/**
 * Who is signed in, per the Worker's session cookie. Sessions last a week and
 * do not slide, so this re-checks when the tab comes back and whenever someone
 * reports a 401 — a lapsed session must read as "sign back in", never as an
 * empty desk.
 */
export function useIdentity(): { auth: AuthState; revalidate: () => void } {
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });
  // Remembered so a lapse can say whose session ended and keep the desk drawn.
  const known = useRef<Identity | null>(null);
  const inFlight = useRef(false);
  const checkedAt = useRef(0);

  const check = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    checkedAt.current = Date.now();
    try {
      const res = await fetch("/auth/me", {
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok && res.status !== 401 && res.status !== 403) {
        throw new Error(`/auth/me answered ${res.status}`);
      }
      const body = res.ok
        ? ((await res.json()) as Partial<Identity> & { signedIn?: boolean })
        : { signedIn: false };
      if (body.signedIn && body.netid) {
        const identity: Identity = {
          netid: body.netid,
          name: body.name ?? body.netid,
          email: body.email ?? "",
        };
        known.current = identity;
        setAuth({ status: "authed", identity });
      } else if (known.current) {
        setAuth({ status: "expired", identity: known.current });
      } else {
        setAuth({ status: "anon" });
      }
    } catch {
      // A dropped connection is not a sign-out: leave a live session alone and
      // let the chat's own connection strip speak for it.
      if (!known.current) setAuth({ status: "unreachable" });
    } finally {
      inFlight.current = false;
    }
  }, []);

  const revalidate = useCallback(() => void check(), [check]);

  useEffect(() => {
    void check();

    const forced = () => void check();
    const ifStale = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - checkedAt.current < RECHECK_AFTER_MS) return;
      void check();
    };

    window.addEventListener(STALE_EVENT, forced);
    window.addEventListener("online", forced);
    document.addEventListener("visibilitychange", ifStale);
    return () => {
      window.removeEventListener(STALE_EVENT, forced);
      window.removeEventListener("online", forced);
      document.removeEventListener("visibilitychange", ifStale);
    };
  }, [check]);

  return { auth, revalidate };
}

/**
 * Hands off to the Worker's Entra flow, remembering the page the student asked
 * for. The callback always lands on "/", so the shell replays this on arrival.
 */
export function signIn(returnTo = location.pathname + location.search) {
  try {
    if (isSamePath(returnTo) && returnTo !== "/") {
      sessionStorage.setItem(RETURN_KEY, returnTo);
    } else {
      sessionStorage.removeItem(RETURN_KEY);
    }
  } catch {
    /* private mode: we just land on home */
  }
  location.href = "/auth/login";
}

/** The page a just-finished sign-in should land on. Readable exactly once. */
export function takeReturnPath(): string | null {
  try {
    const parked = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
    return parked && isSamePath(parked) ? parked : null;
  } catch {
    return null;
  }
}

/** Same-origin, path-only: "//evil.com" and "https://…" never get through. */
function isSamePath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//");
}

export function signOut() {
  location.href = "/auth/logout";
}

// The name PI greets someone by lives in ChatPage as `greetingName`: it is the
// only caller, and its "there" fallback is specific to the greeting rather than
// something a general-purpose display name should do.

/** DO instance-name prefix for a user — must match the server's. */
export function userInstance(netid: string, suffix: string): string {
  return `u-${netid}-${suffix}`;
}
