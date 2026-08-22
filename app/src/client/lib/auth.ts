import { useEffect, useState } from "react";

export type Identity = {
  netid: string;
  name: string;
  email: string;
};

export type AuthState =
  | { status: "loading" }
  | { status: "anon" }
  | { status: "authed"; identity: Identity };

/** Who is signed in, per the Worker's session cookie. */
export function useIdentity(): AuthState {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/auth/me")
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setState({ status: "anon" });
          return;
        }
        const body = (await res.json()) as Identity & { signedIn: boolean };
        setState(
          body.signedIn
            ? {
                status: "authed",
                identity: {
                  netid: body.netid,
                  name: body.name,
                  email: body.email,
                },
              }
            : { status: "anon" }
        );
      })
      .catch(() => {
        if (!cancelled) setState({ status: "anon" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

export function signIn() {
  location.href = "/auth/login";
}

export function signOut() {
  location.href = "/auth/logout";
}

/** DO instance-name prefix for a user — must match the server's. */
export function userInstance(netid: string, suffix: string): string {
  return `u-${netid}-${suffix}`;
}
