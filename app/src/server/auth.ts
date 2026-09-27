/**
 * Princeton CAS sign-in. Only a ticket validated by Princeton can supply the
 * NetID; the browser receives an HttpOnly signed session cookie.
 */
import { z } from "zod";

export type Session = {
  provider: "cas";
  netid: string;
  name: string;
  email: string;
  /** Unix seconds. */
  exp: number;
};

const CAS_BASE = "https://authenticate.princeton.edu/cas";
const SESSION_COOKIE = "pi_session";
const CAS_COOKIE = "pi_cas";
const SESSION_TTL_S = 7 * 24 * 60 * 60;
const LOGIN_TTL_S = 600;
const NETID = /^[a-z][a-z0-9]{0,63}$/;
const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(s: string): Uint8Array<ArrayBuffer> | null {
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" },
    false, ["sign", "verify"]
  );
}

async function signToken(
  payload: Record<string, unknown>,
  secret: string
): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body));
  return `${body}.${b64url(sig)}`;
}

async function verifyToken(
  token: string | undefined,
  secret: string
): Promise<unknown> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const signature = unb64url(sig);
  const raw = unb64url(body);
  if (!signature || !raw) return null;
  const valid = await crypto.subtle.verify(
    "HMAC", await hmacKey(secret), signature, enc.encode(body)
  );
  if (!valid) return null;
  try {
    return JSON.parse(new TextDecoder().decode(raw));
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

function response(body: BodyInit | null, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("cache-control", "no-store");
  headers.set("referrer-policy", "no-referrer");
  return new Response(body, { ...init, headers });
}

const sessionSchema = z.object({
  provider: z.literal("cas"),
  netid: z.string().regex(NETID),
  name: z.string(),
  email: z.string(),
  exp: z.number().finite(),
});

export async function getSession(
  request: Request,
  env: Env
): Promise<Session | null> {
  if (!env.SESSION_SECRET) return null;
  const parsed = sessionSchema.safeParse(await verifyToken(
    readCookie(request, SESSION_COOKIE), env.SESSION_SECRET
  ));
  if (!parsed.success || parsed.data.exp <= Date.now() / 1000) return null;
  return parsed.data;
}

const pendingSchema = z.object({
  state: z.string().min(1),
  service: z.string().url(),
  exp: z.number().finite(),
});

const casResponseSchema = z.object({
  serviceResponse: z.object({
    authenticationFailure: z.unknown().optional(),
    authenticationSuccess: z.object({
      user: z.string().transform((user) => user.toLowerCase()).pipe(z.string().regex(NETID)),
      attributes: z.record(z.string(), z.unknown()).optional(),
    }).optional(),
  }),
});

function attribute(attributes: Record<string, unknown>, key: string): string | undefined {
  const value = attributes[key];
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" && first.trim() ? first.trim() : undefined;
}

/** Handles /auth/*; returns null for other paths. */
export async function handleAuth(
  request: Request,
  env: Env
): Promise<Response | null> {
  const url = new URL(request.url);

  if (url.pathname === "/auth/me") {
    const session = await getSession(request, env);
    return response(JSON.stringify(session ? {
      signedIn: true, netid: session.netid, name: session.name, email: session.email,
    } : { signedIn: false }), {
      status: session ? 200 : 401,
      headers: { "content-type": "application/json" },
    });
  }

  if (url.pathname === "/auth/login" || url.pathname === "/auth/callback") {
    if (!env.SESSION_SECRET) {
      return response("Sign-in isn't configured: set SESSION_SECRET.", { status: 503 });
    }
  }

  if (url.pathname === "/auth/login") {
    const state = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const service = new URL("/auth/callback", url.origin);
    // CAS binds each ticket to this exact service, including our browser state.
    service.searchParams.set("state", state);
    const authorize = new URL(`${CAS_BASE}/login`);
    authorize.searchParams.set("service", service.toString());
    const pending = await signToken({
      state, service: service.toString(), exp: Date.now() / 1000 + LOGIN_TTL_S,
    }, env.SESSION_SECRET);
    return response(null, {
      status: 302,
      headers: {
        location: authorize.toString(),
        "set-cookie": cookie(CAS_COOKIE, pending, LOGIN_TTL_S),
      },
    });
  }

  if (url.pathname === "/auth/callback") {
    const fail = (why: string, status = 400) => response(
      `Sign-in failed: ${why}. Please start again at /auth/login.`, {
        status, headers: { "set-cookie": cookie(CAS_COOKIE, "", 0) },
      }
    );
    const ticket = url.searchParams.get("ticket");
    const state = url.searchParams.get("state");
    if (!ticket || !ticket.startsWith("ST-") || !state) {
      return fail("missing or invalid ticket/state");
    }
    const parsed = pendingSchema.safeParse(await verifyToken(
      readCookie(request, CAS_COOKIE), env.SESSION_SECRET
    ));
    if (!parsed.success || parsed.data.exp <= Date.now() / 1000) {
      return fail("your sign-in attempt expired");
    }
    const pending = parsed.data;
    const service = new URL("/auth/callback", url.origin);
    service.searchParams.set("state", state);
    if (pending.state !== state || pending.service !== service.toString()) {
      return fail("sign-in state mismatch");
    }

    const validate = new URL(`${CAS_BASE}/p3/serviceValidate`);
    validate.search = new URLSearchParams({
      service: pending.service, ticket, format: "JSON",
    }).toString();
    let data: unknown;
    try {
      const res = await fetch(validate, {
        headers: { accept: "application/json" },
        // Workers supports manual/follow only; !res.ok below rejects redirects.
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return fail("Princeton CAS is unavailable", 502);
      data = await res.json();
    } catch {
      return fail("could not validate your ticket with Princeton CAS", 502);
    }
    const validated = casResponseSchema.safeParse(data);
    if (!validated.success) return fail("invalid identity returned by Princeton CAS");
    const cas = validated.data.serviceResponse;
    if ("authenticationFailure" in cas || !cas.authenticationSuccess) {
      return fail("Princeton CAS rejected your ticket");
    }
    const { user: netid, attributes = {} } = cas.authenticationSuccess;
    const session: Session = {
      provider: "cas",
      netid,
      name: attribute(attributes, "displayName") ?? attribute(attributes, "displayname")
        ?? attribute(attributes, "cn") ?? netid,
      email: attribute(attributes, "mail") ?? `${netid}@princeton.edu`,
      exp: Math.floor(Date.now() / 1000) + SESSION_TTL_S,
    };
    const token = await signToken(session, env.SESSION_SECRET);
    return response(null, {
      status: 302,
      headers: [
        ["location", "/"],
        ["set-cookie", cookie(SESSION_COOKIE, token, SESSION_TTL_S)],
        ["set-cookie", cookie(CAS_COOKIE, "", 0)],
        ["set-cookie", cookie("pi_oauth", "", 0)],
      ],
    });
  }

  if (url.pathname === "/auth/logout") {
    // Sign out of PI only; other Princeton services keep their CAS session.
    return response(null, {
      status: 302,
      headers: [
        ["location", "/"],
        ["set-cookie", cookie(SESSION_COOKIE, "", 0)],
        ["set-cookie", cookie(CAS_COOKIE, "", 0)],
        ["set-cookie", cookie("pi_oauth", "", 0)],
      ],
    });
  }

  return null;
}

/** DO instance-name prefix owned by a user; the Worker enforces it. */
export function userPrefix(netid: string): string {
  return `u-${netid}-`;
}
