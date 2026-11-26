import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { Server, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";

const origin = "https://pi.test";
const secret = "test-only-not-a-deployed-session-secret";
const redirectUri = "https://assistant.test/callback";
let worker: Miniflare;
const upstreamCalls: { name: string; netid: string | null; authorization: string | null }[] = [];
const engineSessions = new Map<string, { server: Server; transport: WebStandardStreamableHTTPServerTransport }>();

before(async () => {
  const result = await build({ entryPoints: ["tests/fixtures/course-connector-worker.ts"], bundle: true, write: false, format: "esm", platform: "browser", external: ["cloudflare:workers"] });
  worker = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: result.outputFiles[0].text,
    compatibilityDate: "2026-07-26", compatibilityFlags: ["nodejs_compat"],
    kvNamespaces: ["OAUTH_KV"],
    bindings: { SESSION_SECRET: secret, APP_ORIGIN: origin, ENGINE_MCP_BASE: "https://engine.test", ENGINE_MCP_TOKEN: "test-engine-token" },
    // Real MCP sessions, isolated from the network and all student accounts.
    outboundService: async (request) => {
      assert.equal(new URL(request.url).origin, "https://engine.test");
      if (request.method === "GET") return new Response(null, { status: 405 });
      let pair = engineSessions.get(request.headers.get("mcp-session-id") ?? "");
      if (!pair) {
        const server = new Server({ name: "test-engine", version: "1" }, { capabilities: { tools: {} } });
        server.setRequestHandler("tools/list", () => ({ tools: ["get_user_schedule", "create_schedule", "search_courses"].map(name => ({ name, inputSchema: { type: "object" as const, properties: {} } })) }));
        server.setRequestHandler("tools/call", ({ params }) => {
          const data = { name: params.name, netid: request.headers.get("x-user-netid"), authorization: request.headers.get("authorization") };
          upstreamCalls.push(data);
          return { content: [{ type: "text", text: JSON.stringify({ netid: data.netid }) }] };
        });
        const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: randomUUID, enableJsonResponse: true });
        await server.connect(transport);
        pair = { server, transport };
      }
      const response = await pair.transport.handleRequest(new Request(request.url, { method: request.method, headers: Object.fromEntries(request.headers), body: request.method === "POST" ? await request.text() : undefined }));
      if (pair.transport.sessionId) engineSessions.set(pair.transport.sessionId, pair);
      if (request.method === "DELETE") {
        engineSessions.delete(request.headers.get("mcp-session-id")!);
        await pair.server.close();
      }
      return response;
    },
  }));
});
after(async () => {
  await Promise.all([...engineSessions.values()].map(({ server }) => server.close()));
  await worker?.dispose();
});

function session(netid = "student1") {
  const body = Buffer.from(JSON.stringify({ provider: "cas", netid, name: "Test Student", email: `${netid}@princeton.edu`, exp: Date.now() / 1000 + 300 })).toString("base64url");
  return `pi_session=${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}
function request(path: string, init?: RequestInit) {
  return worker.dispatchFetch(new URL(path, origin), { ...init, redirect: "manual" });
}
async function flow(netid = "student1") {
  const registered = await request("/connect/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "Test assistant", redirect_uris: [redirectUri], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }) });
  assert.equal(registered.status, 201);
  const client = await registered.json() as { client_id: string };
  const verifier = randomBytes(32).toString("base64url");
  const authorize = new URL("/connect/authorize", origin);
  authorize.search = new URLSearchParams({ client_id: client.client_id, redirect_uri: redirectUri, response_type: "code", scope: "courses:read plans:write offline_access", state: "client-state", resource: `${origin}/mcp`, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" }).toString();
  const page = await request(authorize.href, { headers: { cookie: session(netid) } });
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("referrer-policy"), "same-origin", "consent forms must preserve the browser's Origin header");
  assert.match(page.headers.get("content-security-policy")!, /form-action 'self' https:\/\/assistant\.test;/);
  const html = await page.text();
  const handle = html.match(/name="handle" value="([^"]+)"/)![1];
  const subject = html.match(/name="subject" value="([^"]+)"/)![1];
  const cookie = [session(netid), ...page.headers.getSetCookie().map(c => c.split(";")[0])].join("; ");
  return { client, verifier, authorize, handle, subject, cookie };
}
type Flow = Awaited<ReturnType<typeof flow>>;
async function approve(f: Flow, write = false, options: { cookie?: string; requestOrigin?: string } = {}) {
  const body = new URLSearchParams({ handle: f.handle, subject: f.subject, decision: "approve", scope: "courses:read" });
  if (write) body.append("scope", "plans:write");
  return request("/connect/authorize", { method: "POST", headers: { origin: options.requestOrigin ?? origin, cookie: options.cookie ?? f.cookie }, body });
}
async function exchange(f: Flow, code: string, verifier = f.verifier, resource = `${origin}/mcp`) {
  return request("/connect/token", { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: f.client.client_id, redirect_uri: redirectUri, code_verifier: verifier, resource }) });
}
async function tokenFor(write = false, netid = "student1") {
  const f = await flow(netid);
  const approved = await approve(f, write);
  assert.equal(approved.status, 302);
  const location = new URL(approved.headers.get("location")!);
  assert.equal(location.origin, "https://assistant.test");
  assert.equal(location.searchParams.get("state"), "client-state");
  const exchanged = await exchange(f, location.searchParams.get("code")!);
  assert.equal(exchanged.status, 200, await exchanged.clone().text());
  return { f, token: await exchanged.json() as { access_token: string; refresh_token: string; scope: string } };
}
function rpc(token: string, method: string, params: unknown = {}, headers: Record<string, string> = {}) {
  return request("/mcp", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
}

test("OAuth metadata advertises a protected MCP resource and unauthorized requests challenge", async () => {
  const metadata = await request("/.well-known/oauth-protected-resource/mcp");
  assert.equal(metadata.status, 200);
  assert.deepEqual((await metadata.json() as any).scopes_supported, ["courses:read"]);
  const response = await rpc("forged-token", "tools/list", {}, { "x-user-netid": "student1", cookie: session() });
  assert.equal(response.status, 401);
  assert.match(response.headers.get("www-authenticate")!, /resource_metadata/);
});

test("unsigned browsers return through CAS before connector consent", async () => {
  const f = await flow();
  const response = await request(f.authorize.href);
  assert.equal(response.status, 302);
  const login = new URL(response.headers.get("location")!);
  assert.equal(login.pathname, "/auth/login");
  assert.equal(login.searchParams.get("returnTo"), f.authorize.pathname + f.authorize.search);
});

test("consent rejects CSRF, another browser, and switching accounts", async () => {
  const f = await flow();
  assert.equal((await approve(f, false, { requestOrigin: "https://evil.test" })).status, 403);
  assert.equal((await approve(f, false, { requestOrigin: "null" })).status, 403);
  assert.equal((await request("/connect/authorize", { method: "POST", headers: { cookie: f.cookie }, body: new URLSearchParams({ handle: f.handle, subject: f.subject, decision: "approve" }) })).status, 403);
  assert.equal((await approve(f, false, { cookie: session() })).status, 400);
  const swapped = f.cookie.replace(/^pi_session=[^;]+/, session("student2"));
  assert.equal((await approve(f, false, { cookie: swapped })).status, 400);
  assert.equal((await approve(f)).status, 302);
  assert.equal((await approve(f)).status, 400);
});

test("PKCE, redirect registration, and resource audience are enforced", async () => {
  const f = await flow();
  const unsafe = new URL(f.authorize);
  unsafe.searchParams.set("redirect_uri", "https://evil.test/callback");
  assert.equal((await request(unsafe.href, { headers: { cookie: session() } })).status, 400);
  const unbound = new URL(f.authorize);
  unbound.searchParams.delete("code_challenge");
  unbound.searchParams.delete("code_challenge_method");
  const rejected = await request(unbound.href, { headers: { cookie: session() } });
  assert.ok(rejected.status === 400 || (rejected.status === 302 && new URL(rejected.headers.get("location")!).searchParams.has("error")));
  const approved = await approve(f);
  const code = new URL(approved.headers.get("location")!).searchParams.get("code")!;
  assert.equal((await exchange(f, code, randomBytes(32).toString("base64url"))).status, 400);
  assert.equal((await exchange(f, code, f.verifier, "https://evil.test/mcp")).status, 400);
});

test("read grants block direct writes and forward only the CAS identity and engine credential", async () => {
  const { token } = await tokenFor();
  assert.doesNotMatch(token.scope, /plans:write/);
  const count = upstreamCalls.length;
  const denied = await rpc(token.access_token, "tools/call", { name: "create_schedule", arguments: {} });
  assert.equal((await denied.json() as any).result.isError, true);
  assert.equal(upstreamCalls.length, count);
  const read = await rpc(token.access_token, "tools/call", { name: "get_user_schedule", arguments: {} }, { "x-user-netid": "student2", "x-external-user-id": "student2" });
  assert.equal(read.status, 200);
  assert.match(JSON.stringify(await read.json()), /student1/);
  assert.deepEqual(upstreamCalls.at(-1), { name: "get_user_schedule", netid: "student1", authorization: "Bearer test-engine-token" });
  assert.equal(engineSessions.size, 0, "upstream sessions must be deleted after requests");
  assert.equal((await rpc(token.access_token, "tools/list", {}, { origin: "https://evil.test" })).status, 403);
});

test("optional editing works and per-student grants can be revoked only by their owner", async () => {
  const { f, token } = await tokenFor(true);
  assert.match(token.scope, /plans:write/);
  const write = await rpc(token.access_token, "tools/call", { name: "create_schedule", arguments: { term: 1274, title: "Test" } });
  assert.equal((await write.json() as any).result.isError, undefined);
  assert.equal(engineSessions.size, 0);
  const kv = await worker.getKVNamespace("OAUTH_KV");
  const grants = await kv.list({ prefix: "grant:" });
  assert.ok(grants.keys.length > 0);
  // The user-facing management page identifies the grant without exposing tokens.
  const page = await request("/connect", { headers: { cookie: session() } });
  assert.equal(page.headers.get("referrer-policy"), "same-origin", "disconnect forms must preserve the browser's Origin header");
  assert.match(page.headers.get("content-security-policy")!, /form-action 'self';/);
  const html = await page.text();
  assert.doesNotMatch(html, new RegExp(token.access_token));
  const grantRecords = await Promise.all(grants.keys.map(k => kv.get(k.name, "json") as Promise<any>));
  const grant = grantRecords.find(g => g.clientId === f.client.client_id);
  assert.ok(grant);
  const revoke = (netid: string, requestOrigin = origin) => request("/connect/revoke", { method: "POST", headers: { origin: requestOrigin, cookie: session(netid) }, body: new URLSearchParams({ grant: grant.id }) });
  assert.equal((await revoke("student1", "https://evil.test")).status, 403);
  assert.equal((await revoke("student1", "null")).status, 403);
  await revoke("student2");
  assert.equal((await rpc(token.access_token, "ping")).status, 200);
  assert.equal((await revoke("student1")).status, 303);
  assert.equal((await rpc(token.access_token, "ping")).status, 401);
  const refresh = await request("/connect/token", { method: "POST", body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: token.refresh_token, client_id: f.client.client_id, resource: `${origin}/mcp` }) });
  assert.equal(refresh.status, 400);
});

test("refresh preserves identity and cannot escalate a read grant", async () => {
  const { f, token } = await tokenFor(false, "student2");
  const refresh = await request("/connect/token", { method: "POST", body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: token.refresh_token, client_id: f.client.client_id, resource: `${origin}/mcp`, scope: "plans:write" }) });
  assert.equal(refresh.status, 400);
  const allowed = await request("/connect/token", { method: "POST", body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: token.refresh_token, client_id: f.client.client_id, resource: `${origin}/mcp` }) });
  assert.equal(allowed.status, 200);
  const renewed = await allowed.json() as any;
  assert.doesNotMatch(renewed.scope, /plans:write/);
  const read = await rpc(renewed.access_token, "tools/call", { name: "get_user_schedule", arguments: {} });
  assert.match(JSON.stringify(await read.json()), /student2/);
  assert.equal(engineSessions.size, 0);
});
