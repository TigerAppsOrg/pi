import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { afterEach, mock, test } from "node:test";
import { getSession, handleAuth, userPrefix } from "../src/server/auth.ts";

const origin = "https://pi.tigerapps.org";
const env = { SESSION_SECRET: "test-only-session-secret" } as Env;

afterEach(() => mock.restoreAll());

function signed(payload: unknown): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", env.SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function cookieFrom(res: Response, name: string): string {
  const entry = res.headers.getSetCookie().find((value) => value.startsWith(`${name}=`));
  assert.ok(entry, `missing ${name}`);
  return entry.split(";")[0];
}

async function start(base = origin) {
  const res = await handleAuth(new Request(`${base}/auth/login`), env);
  assert.ok(res);
  assert.equal(res.status, 302);
  const login = new URL(res.headers.get("location")!);
  const service = login.searchParams.get("service")!;
  const callback = new URL(service);
  callback.searchParams.set("ticket", "ST-test-ticket");
  return { res, login, service, callback, cookie: cookieFrom(res, "pi_cas") };
}

function success(user = "jd1234", attributes?: Record<string, unknown>) {
  return Response.json({ serviceResponse: { authenticationSuccess: { user, attributes } } });
}

test("login redirects to Princeton with a unique, cookie-bound service URL", async () => {
  const first = await start();
  const second = await start();
  assert.equal(first.login.origin, "https://authenticate.princeton.edu");
  assert.equal(first.login.pathname, "/cas/login");
  const service = new URL(first.service);
  assert.equal(service.origin, origin);
  assert.equal(service.pathname, "/auth/callback");
  assert.match(service.searchParams.get("state")!, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first.service, second.service);
  assert.match(first.res.headers.get("set-cookie")!, /HttpOnly; Secure; SameSite=Lax; Max-Age=600/);
  assert.equal(first.res.headers.get("cache-control"), "no-store");
  assert.equal(first.res.headers.get("referrer-policy"), "no-referrer");
});

test("validated CAS NetID owns the session even when the email is an alias", async () => {
  const flow = await start();
  flow.callback.searchParams.set("netid", "attacker");
  const fetchMock = mock.method(globalThis, "fetch", async (input: URL, init: RequestInit) => {
    const url = new URL(input);
    assert.equal(url.origin, "https://authenticate.princeton.edu");
    assert.equal(url.pathname, "/cas/p3/serviceValidate");
    assert.equal(url.searchParams.get("service"), flow.service);
    assert.equal(url.searchParams.get("ticket"), "ST-test-ticket");
    assert.equal(url.searchParams.get("format"), "JSON");
    assert.equal(init.redirect, "manual");
    assert.ok(init.signal instanceof AbortSignal);
    return success("JD1234", { displayname: ["Jane Doe"], mail: ["jane.doe@princeton.edu"] });
  });
  const res = await handleAuth(new Request(flow.callback, { headers: { cookie: flow.cookie } }), env);
  assert.ok(res);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/");
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.match(res.headers.getSetCookie().find((v) => v.startsWith("pi_session="))!, /Max-Age=604800/);
  assert.equal(cookieFrom(res, "pi_cas"), "pi_cas=");
  const req = new Request(`${origin}/auth/me`, { headers: { cookie: cookieFrom(res, "pi_session") } });
  const session = await getSession(req, env);
  assert.equal(session?.provider, "cas");
  assert.equal(session?.netid, "jd1234");
  assert.equal(userPrefix(session!.netid), "u-jd1234-");
  const me = await handleAuth(req, env);
  assert.equal(me?.status, 200);
  assert.equal(me?.headers.get("cache-control"), "no-store");
  assert.deepEqual(await me?.json(), {
    signedIn: true, netid: "jd1234", name: "Jane Doe", email: "jane.doe@princeton.edu",
  });
});

for (const [label, attributes, name, email] of [
  ["no attributes", undefined, "jd1234", "jd1234@princeton.edu"],
  ["scalar attributes", { displayName: "Jane Doe", mail: "jane@princeton.edu" }, "Jane Doe", "jane@princeton.edu"],
  ["malformed attributes", { displayName: 42, mail: [], cn: ["Jane"] }, "Jane", "jd1234@princeton.edu"],
] as const) {
  test(`CAS profile supports ${label}`, async () => {
    const flow = await start();
    mock.method(globalThis, "fetch", async () => success("jd1234", attributes));
    const res = await handleAuth(new Request(flow.callback, { headers: { cookie: flow.cookie } }), env);
    assert.equal(res?.status, 302);
    const session = await getSession(new Request(origin, { headers: { cookie: cookieFrom(res!, "pi_session") } }), env);
    assert.equal(session?.name, name);
    assert.equal(session?.email, email);
  });
}

for (const scenario of ["missing cookie", "other browser", "tampered cookie", "expired cookie", "missing expiry", "wrong state", "wrong origin", "missing ticket", "proxy ticket"]) {
  test(`rejects ${scenario} before contacting CAS`, async () => {
    const flow = await start();
    let cookie = flow.cookie;
    const payload = JSON.parse(Buffer.from(cookie.split("=")[1].split(".")[0], "base64url").toString());
    if (scenario === "missing cookie") cookie = "";
    if (scenario === "other browser") cookie = (await start()).cookie;
    if (scenario === "tampered cookie") cookie += "extra";
    if (scenario === "expired cookie") cookie = `pi_cas=${signed({ ...payload, exp: 1 })}`;
    if (scenario === "missing expiry") {
      delete payload.exp;
      cookie = `pi_cas=${signed(payload)}`;
    }
    if (scenario === "wrong state") flow.callback.searchParams.set("state", "wrong");
    if (scenario === "wrong origin") flow.callback.hostname = "other.tigerapps.org";
    if (scenario === "missing ticket") flow.callback.searchParams.delete("ticket");
    if (scenario === "proxy ticket") flow.callback.searchParams.set("ticket", "PT-proxy-ticket");
    const fetchMock = mock.method(globalThis, "fetch", async () => { throw new Error("must not fetch"); });
    const res = await handleAuth(new Request(flow.callback, { headers: { cookie } }), env);
    assert.equal(res?.status, 400);
    assert.equal(fetchMock.mock.callCount(), 0);
    assert.equal(cookieFrom(res!, "pi_cas"), "pi_cas=");
    assert.ok(!res?.headers.getSetCookie().some((v) => v.startsWith("pi_session=")));
  });
}

for (const [label, body] of [
  ["rejected ticket", { serviceResponse: { authenticationFailure: { code: "INVALID_TICKET" } } }],
  ["missing user", { serviceResponse: { authenticationSuccess: {} } }],
  ["email in place of NetID", { serviceResponse: { authenticationSuccess: { user: "jane.doe@princeton.edu" } } }],
  ["unsafe NetID", { serviceResponse: { authenticationSuccess: { user: "jd1234-desk" } } }],
  ["both success and failure", { serviceResponse: { authenticationSuccess: { user: "jd1234" }, authenticationFailure: {} } }],
  ["unexpected JSON", null],
] as const) {
  test(`does not create a session for ${label}`, async () => {
    const flow = await start();
    mock.method(globalThis, "fetch", async () => Response.json(body));
    const res = await handleAuth(new Request(flow.callback, { headers: { cookie: flow.cookie } }), env);
    assert.equal(res?.status, 400);
    assert.ok(!res?.headers.getSetCookie().some((v) => v.startsWith("pi_session=")));
  });
}

for (const scenario of ["network error", "timeout", "HTTP error", "redirect", "non-JSON body"]) {
  test(`handles CAS ${scenario} without exposing the ticket`, async () => {
    const flow = await start();
    mock.method(globalThis, "fetch", async () => {
      if (scenario === "network error") throw new Error("ST-test-ticket connection failure");
      if (scenario === "timeout") throw new DOMException("timed out", "TimeoutError");
      if (scenario === "redirect") return Response.redirect("https://example.com/untrusted", 302);
      return new Response("<html>upstream error</html>", { status: scenario === "HTTP error" ? 503 : 200 });
    });
    const res = await handleAuth(new Request(flow.callback, { headers: { cookie: flow.cookie } }), env);
    assert.equal(res?.status, 502);
    assert.ok(!(await res!.text()).includes("ST-test-ticket"));
  });
}

test("CAS rejection prevents replay of an already redeemed service ticket", async () => {
  const flow = await start();
  let redeemed = false;
  mock.method(globalThis, "fetch", async () => {
    if (redeemed) return Response.json({ serviceResponse: { authenticationFailure: { code: "INVALID_TICKET" } } });
    redeemed = true;
    return success();
  });
  const req = () => new Request(flow.callback, { headers: { cookie: flow.cookie } });
  assert.equal((await handleAuth(req(), env))?.status, 302);
  assert.equal((await handleAuth(req(), env))?.status, 400);
});

test("legacy Entra, expired, malformed and tampered session cookies are rejected", async () => {
  const session = { provider: "cas", netid: "jd1234", name: "Jane", email: "jd1234@princeton.edu", exp: Date.now() / 1000 + 60 };
  for (const value of [
    signed({ ...session, provider: undefined }),
    signed({ ...session, exp: 1 }),
    signed({ ...session, exp: undefined }),
    signed({ ...session, netid: "jd1234-other" }),
    signed(null),
    signed(session) + ".trailing",
    signed(session) + "bad",
    "not-a-token",
  ]) {
    const req = new Request(`${origin}/auth/me`, { headers: { cookie: `pi_session=${value}` } });
    assert.equal(await getSession(req, env), null);
    const me = await handleAuth(req, env);
    assert.equal(me?.status, 401);
    assert.deepEqual(await me?.json(), { signedIn: false });
  }
});

test("logout clears session, pending CAS and legacy OAuth cookies", async () => {
  const res = await handleAuth(new Request(`${origin}/auth/logout`), env);
  assert.equal(res?.status, 302);
  assert.equal(res?.headers.get("location"), "/");
  for (const name of ["pi_session", "pi_cas", "pi_oauth"]) {
    assert.equal(cookieFrom(res!, name), `${name}=`);
  }
  assert.ok(res?.headers.getSetCookie().every((v) => v.includes("Max-Age=0")));
});

test("SESSION_SECRET is the only required sign-in configuration", async () => {
  await start();
  for (const path of ["/auth/login", "/auth/callback"]) {
    assert.equal((await handleAuth(new Request(origin + path), {} as Env))?.status, 503);
  }
  assert.equal(await getSession(new Request(origin), {} as Env), null);
  assert.equal(await handleAuth(new Request(`${origin}/other`), env), null);
});

test("development service uses its own origin", async () => {
  const flow = await start("http://localhost:5173");
  assert.equal(new URL(flow.service).origin, "http://localhost:5173");
});
