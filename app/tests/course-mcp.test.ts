import assert from "node:assert/strict";
import { test } from "node:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { COURSE_READ, PLAN_WRITE, createCourseServer, handleCourseMcp, type CourseUpstream } from "../src/server/course-mcp.ts";
import { connectorPage, consentPage } from "../src/server/course-consent.ts";

const tool = (name: string) => ({ name, inputSchema: { type: "object" as const, properties: {} } });
function fakeEngine() {
  const calls: { source: string; name: string; args: Record<string, unknown> }[] = [];
  const upstream: CourseUpstream = {
    async list(source) {
      // Deliberately overlapping catalogs and an unexpected destructive tool.
      return {
        junction: [tool("search_courses"), tool("create_schedule"), tool("get_user_schedules"), tool("get_course_evaluations"), tool("delete_everything")],
        princetoncourses: [tool("get_course_evaluations"), tool("get_instructor")],
        path: [tool("get_requirement_tree"), tool("get_user_schedule"), tool("update_user_schedule")],
      }[source];
    },
    async call(source, name, args) {
      calls.push({ source, name, args });
      return { content: [{ type: "text", text: JSON.stringify({ source, name, args }) }] };
    },
  };
  return { upstream, calls };
}
async function connected(scope: string[], upstream: CourseUpstream) {
  const client = new Client({ name: "connector-test", version: "1" });
  const transport = new StreamableHTTPClientTransport(new URL("https://pi.test/mcp"), {
    fetch: (url, init) => handleCourseMcp(new Request(url, init), { netid: "student1", scope }, upstream),
  });
  await client.connect(transport);
  return client;
}

test("real MCP handshake exposes only allowlisted read tools from their designated source", async (t) => {
  const { upstream, calls } = fakeEngine();
  const client = await connected([COURSE_READ], upstream);
  t.after(() => client.close());
  const catalog = await client.listTools();
  assert.deepEqual(catalog.tools.map(t => t.name).sort(), ["search_courses", "get_user_schedules", "get_course_evaluations", "get_instructor", "get_requirement_tree", "get_user_schedule"].sort());
  assert.ok(catalog.tools.every(t => t.annotations?.readOnlyHint));
  await client.callTool({ name: "get_course_evaluations", arguments: { code: "COS 217" } });
  assert.deepEqual(calls, [{ source: "princetoncourses", name: "get_course_evaluations", args: { code: "COS 217" } }]);
  assert.match(client.getInstructions()!, /not an official transcript/);
  assert.equal((await client.listPrompts()).prompts[0].name, "plan_semester");
  const prompt = await client.getPrompt({ name: "plan_semester", arguments: { goal: "Spring 2027, COS BSE, class of 2029" } });
  assert.match(JSON.stringify(prompt), /Show the proposal before saving/);
});

test("guessing a write or unlisted tool cannot bypass read-only authorization", async (t) => {
  const { upstream, calls } = fakeEngine();
  const client = await connected([COURSE_READ], upstream);
  t.after(() => client.close());
  for (const name of ["create_schedule", "update_user_schedule", "delete_schedule", "subscribe_to_snatch", "delete_everything", "toString"]) {
    assert.equal((await client.callTool({ name, arguments: {} })).isError, true);
  }
  assert.equal(calls.length, 0);
});

test("explicit editing scope enables saved-plan tools but not enrollment or alerts", async (t) => {
  const { upstream, calls } = fakeEngine();
  const client = await connected([COURSE_READ, PLAN_WRITE], upstream);
  t.after(() => client.close());
  const catalog = await client.listTools();
  const write = catalog.tools.find(t => t.name === "create_schedule")!;
  assert.equal(write.annotations?.readOnlyHint, false);
  assert.match(write.description!, /never course registration/);
  assert.equal((await client.callTool({ name: "create_schedule", arguments: { term: 1274, title: "Proposed spring" } })).isError, undefined);
  assert.equal((await client.callTool({ name: "subscribe_to_snatch", arguments: {} })).isError, true);
  assert.equal(calls.length, 1);
});

test("identity arguments are rejected except public instructor search keys", async (t) => {
  const { upstream, calls } = fakeEngine();
  const client = await connected([COURSE_READ], upstream);
  t.after(() => client.close());
  for (const key of ["netid", "userId", "externalUserId", "user_netid", "user_id"]) {
    assert.equal((await client.callTool({ name: "get_user_schedule", arguments: { [key]: "otherstudent" } })).isError, true);
  }
  await client.callTool({ name: "get_instructor", arguments: { netid: "professor" } });
  assert.equal(calls.length, 1);
});

test("upstream failures omit credentials and uncertain writes are never retried", async (t) => {
  const { upstream } = fakeEngine();
  let attempts = 0;
  upstream.call = async () => { attempts++; throw new Error("secret-token https://private.example"); };
  upstream.list = async () => { throw new Error("catalog-secret-token"); };
  const client = await connected([COURSE_READ, PLAN_WRITE], upstream);
  t.after(() => client.close());
  const result = await client.callTool({ name: "create_schedule", arguments: {} });
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result), /may have been saved/);
  assert.doesNotMatch(JSON.stringify(result), /secret-token|private.example/);
  assert.equal(attempts, 1);
  await assert.rejects(client.listTools(), error => !String(error).includes("catalog-secret-token") && String(error).includes("catalog is unavailable"));
});

test("missing permission or malformed identity cannot create a course session", () => {
  const { upstream } = fakeEngine();
  assert.throws(() => createCourseServer({ netid: "student1", scope: [] }, upstream));
  assert.throws(() => createCourseServer({ netid: "../other", scope: [COURSE_READ] }, upstream));
});

test("consent escapes client-controlled text and makes plan editing opt-in", async () => {
  const response = consentPage({ clientId: "id", clientName: '<script>alert("x")</script>', redirectUri: "https://client.test/callback", redirectHost: '<img src=x onerror=alert(1)>', redirectIsLoopback: false, scope: [COURSE_READ, PLAN_WRITE] }, "handle", "student1", "proof", new Headers());
  const html = await response.text();
  assert.doesNotMatch(html, /<script>|<img/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /type="checkbox" name="scope" value="plans:write">/);
  assert.match(response.headers.get("content-security-policy")!, /frame-ancestors 'none'/);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("consent CSP permits only the callback origin and cannot inject directives", () => {
  const policy = (uri: string) => connectorPage("Test", "", undefined, 200, uri).headers.get("content-security-policy")!;
  assert.match(policy("https://assistant.test/callback?state=private"), /form-action 'self' https:\/\/assistant\.test;/);
  assert.doesNotMatch(policy("https://assistant.test/callback?state=private"), /callback|private/);
  assert.match(policy("http://127.0.0.1:4321/callback"), /form-action 'self' http:\/\/127\.0\.0\.1:4321;/);
  for (const uri of ["https://evil.test;script-src/callback", "https://*.evil.test/callback", "javascript:alert(1)"]) {
    assert.equal(policy(uri), "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  }
});
