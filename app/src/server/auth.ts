/**
 * Princeton sign-in via Microsoft Entra ID (OIDC authorization code + PKCE,
 * confidential client). The Worker owns the whole flow; the browser only ever
 * sees an HttpOnly signed session cookie.
 *
 * netid is derived from the account email's local part (jdoe@princeton.edu →
 * jdoe) — there is deliberately no way to choose one.
 */

export type Session = {
  netid: string;
  name: string;
  email: string;
  /** Unix seconds. */
  exp: number;
};

const SESSION_COOKIE = "pi_session";
const OAUTH_COOKIE = "pi_oauth";
const SESSION_TTL_S = 7 * 24 * 60 * 60;
const ALLOWED_DOMAIN = "princeton.edu";

/* ── small codecs ─────────────────────────────────────────────────── */

const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(s: string): Uint8Array | null {
  try {
    const pad = s.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

async function signToken(
  payload: Record<string, unknown>,
  secret: string
): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  return `${body}.${await hmac(secret, body)}`;
}

async function verifyToken<T>(
  token: string | undefined,
  secret: string
): Promise<T | null> {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = await hmac(secret, body);
  if (sig.length !== expected.length) return null;
  // constant-time-ish compare
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;
  const raw = unb64url(body);
  if (!raw) return null;
  try {
    return JSON.parse(new TextDecoder().decode(raw)) as T;
  } catch {
    return null;
  }
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}

function cookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

/* ── session ──────────────────────────────────────────────────────── */

export async function getSession(
  request: Request,
  env: Env
): Promise<Session | null> {
  if (!env.SESSION_SECRET) return null;
  const s = await verifyToken<Session>(
    readCookie(request, SESSION_COOKIE),
    env.SESSION_SECRET
  );
  if (!s || typeof s.netid !== "string" || !s.netid) return null;
  if (typeof s.exp !== "number" || s.exp < Date.now() / 1000) return null;
  return s;
}

/* ── routes ───────────────────────────────────────────────────────── */

function authority(env: Env): string {
  return `https://login.microsoftonline.com/${env.ENTRA_TENANT_ID}`;
}

function misconfigured(env: Env): Response | null {
  if (env.ENTRA_TENANT_ID && env.ENTRA_CLIENT_ID && env.ENTRA_CLIENT_SECRET && env.SESSION_SECRET) {
    return null;
  }
  return new Response(
    "Sign-in isn't configured: set ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET, and SESSION_SECRET.",
    { status: 503 }
  );
}

/** Handles /auth/*; returns null for other paths. */
export async function handleAuth(
  request: Request,
  env: Env
): Promise<Response | null> {
  const url = new URL(request.url);
  const redirectUri = `${url.origin}/auth/callback`;

  if (url.pathname === "/auth/me") {
    const session = await getSession(request, env);
    if (!session) return Response.json({ signedIn: false }, { status: 401 });
    return Response.json({
      signedIn: true,
      netid: session.netid,
      name: session.name,
      email: session.email,
    });
  }

  if (url.pathname === "/auth/login") {
    const bad = misconfigured(env);
    if (bad) return bad;
    const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = b64url(
      await crypto.subtle.digest("SHA-256", enc.encode(verifier))
    );
    const authorize = new URL(`${authority(env)}/oauth2/v2.0/authorize`);
    authorize.search = new URLSearchParams({
      client_id: env.ENTRA_CLIENT_ID,
      response_type: "code",
      redirect_uri: redirectUri,
      response_mode: "query",
      scope: "openid profile email",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();
    const pending = await signToken(
      { state, verifier, exp: Date.now() / 1000 + 600 },
      env.SESSION_SECRET
    );
    return new Response(null, {
      status: 302,
      headers: {
        location: authorize.toString(),
        "set-cookie": cookie(OAUTH_COOKIE, pending, 600),
      },
    });
  }

  if (url.pathname === "/auth/callback") {
    const bad = misconfigured(env);
    if (bad) return bad;
    const fail = (why: string) =>
      new Response(`Sign-in failed: ${why}`, { status: 400 });

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) {
      return fail(url.searchParams.get("error_description") ?? "missing code");
    }
    const pending = await verifyToken<{
      state: string;
      verifier: string;
      exp: number;
    }>(readCookie(request, OAUTH_COOKIE), env.SESSION_SECRET);
    if (!pending || pending.exp < Date.now() / 1000) {
      return fail("your sign-in attempt expired — please try again");
    }
    if (pending.state !== state) return fail("state mismatch");

    const tokenRes = await fetch(`${authority(env)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.ENTRA_CLIENT_ID,
        client_secret: env.ENTRA_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: pending.verifier,
      }),
    });
    if (!tokenRes.ok) {
      const detail = await tokenRes.text();
      console.warn("token exchange failed", tokenRes.status, detail.slice(0, 300));
      return fail("could not complete sign-in with Microsoft");
    }
    const tokens = (await tokenRes.json()) as { id_token?: string };
    if (!tokens.id_token) return fail("no identity returned");

    // The id_token comes straight from Microsoft's token endpoint over TLS
    // (back channel), so the transport authenticates it; we still check the
    // claims that matter.
    const claimsRaw = unb64url(tokens.id_token.split(".")[1] ?? "");
    if (!claimsRaw) return fail("malformed identity token");
    let claims: Record<string, unknown>;
    try {
      claims = JSON.parse(new TextDecoder().decode(claimsRaw));
    } catch {
      return fail("malformed identity token");
    }
    if (claims.aud !== env.ENTRA_CLIENT_ID) return fail("wrong audience");
    if (claims.tid !== env.ENTRA_TENANT_ID) return fail("wrong tenant");
    if (typeof claims.exp !== "number" || claims.exp < Date.now() / 1000) {
      return fail("expired identity token");
    }

    const email = String(
      claims.email ?? claims.preferred_username ?? claims.upn ?? ""
    ).toLowerCase();
    const match = email.match(/^([a-z0-9._%+-]+)@([a-z0-9.-]+)$/);
    if (!match || match[2] !== ALLOWED_DOMAIN) {
      return fail(
        `a ${ALLOWED_DOMAIN} account is required (signed in as ${email || "unknown"})`
      );
    }
    // Princeton often signs people in with an email ALIAS (jane.doe@… for
    // netid jd1234), so resolve the real netid through OIT's directory.
    const netid = await resolveNetid(email, match[1], env);

    const session: Session = {
      netid,
      name: String(claims.name ?? netid),
      email,
      exp: Math.floor(Date.now() / 1000) + SESSION_TTL_S,
    };
    const token = await signToken(session, env.SESSION_SECRET);
    return new Response(null, {
      status: 302,
      headers: [
        ["location", "/"],
        ["set-cookie", cookie(SESSION_COOKIE, token, SESSION_TTL_S)],
        ["set-cookie", cookie(OAUTH_COOKIE, "", 0)],
      ],
    });
  }

  if (url.pathname === "/auth/logout") {
    return new Response(null, {
      status: 302,
      headers: {
        location: "/",
        "set-cookie": cookie(SESSION_COOKIE, "", 0),
      },
    });
  }

  return null;
}

/** DO instance-name prefix owned by a user; the Worker enforces it. */
export function userPrefix(netid: string): string {
  return `u-${netid}-`;
}

/* ── alias → netid via OIT's ActiveDirectory API ──────────────────── */

const OIT_TOKEN_URL = "https://api.princeton.edu/token";
const DEFAULT_AD_BASE = "https://api.princeton.edu/active-directory/1.0.6";

/** WSO2 access token, cached for the isolate's lifetime. */
let oitTokenCache: { token: string; exp: number } | null = null;

async function oitToken(env: Env): Promise<string> {
  if (oitTokenCache && oitTokenCache.exp > Date.now() / 1000 + 30) {
    return oitTokenCache.token;
  }
  const res = await fetch(OIT_TOKEN_URL, {
    method: "POST",
    headers: {
      authorization: `Basic ${btoa(`${env.OIT_CONSUMER_KEY}:${env.OIT_CONSUMER_SECRET}`)}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`OIT token grant failed: ${res.status}`);
  const body = (await res.json()) as {
    access_token: string;
    expires_in?: number;
  };
  oitTokenCache = {
    token: body.access_token,
    exp: Date.now() / 1000 + (body.expires_in ?? 3000),
  };
  return body.access_token;
}

async function oitUsersLookup(
  env: Env,
  token: string,
  params: Record<string, string>
): Promise<string | null> {
  const base = (env.OIT_AD_BASE || DEFAULT_AD_BASE).replace(/\/$/, "");
  const res = await fetch(`${base}/users?${new URLSearchParams(params)}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  });
  if (!res.ok) return null;
  const text = await res.text();
  if (!text.trim() || text.startsWith("<")) return null;
  try {
    const data = JSON.parse(text) as unknown;
    const list = Array.isArray(data)
      ? data
      : typeof data === "object" && data != null
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ((data as any).users ?? (data as any).result ?? [data])
        : [];
    for (const entry of list) {
      const uid = entry?.uid ?? entry?.netid;
      if (typeof uid === "string" && uid) return uid.toLowerCase();
    }
  } catch {
    /* fall through */
  }
  return null;
}

/**
 * Map a sign-in email to the real netid. The email's local part may be an
 * alias, so the directory (`mail` attribute) is authoritative; if lookup is
 * unavailable or misses, the local part is the best remaining guess.
 */
async function resolveNetid(
  email: string,
  localpart: string,
  env: Env
): Promise<string> {
  if (!env.OIT_CONSUMER_KEY || !env.OIT_CONSUMER_SECRET) {
    console.warn("OIT credentials not set — using email local part as netid");
    return localpart;
  }
  try {
    const token = await oitToken(env);
    const byMail = await oitUsersLookup(env, token, { mail: email });
    if (byMail) return byMail;
    // The local part may already be the netid — confirm against the directory.
    const byUid = await oitUsersLookup(env, token, { uid: localpart });
    if (byUid === localpart) return localpart;
    console.warn(`OIT lookup could not resolve ${email}; using local part`);
  } catch (err) {
    console.warn("OIT lookup failed", err);
  }
  return localpart;
}
