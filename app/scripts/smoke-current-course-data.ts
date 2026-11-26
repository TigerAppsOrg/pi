/** Read-only live source check through the actual connector MCP transport.
 * Run from app: npx tsx scripts/smoke-current-course-data.ts 1274
 * Does not use production identities, credentials, plans or the production MCP.
 */
import assert from "node:assert/strict";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { COURSE_READ, handleCourseMcp } from "../src/server/course-mcp.ts";
const term = Number(process.argv[2]);
assert.ok(Number.isInteger(term) && term >= 1000 && term <= 1999 && [2, 4].includes(term % 10), "Pass an explicit Fall/Spring term, e.g. 1274");
const client = new Client({ name: "pi-live-public-smoke", version: "1" });
const upstream = { list: async () => [], call: async () => { throw new Error("No engine in this public-source smoke test"); } };
try {
  await client.connect(new StreamableHTTPClientTransport(new URL("https://local.test/mcp"), {
    fetch: (url, init) => handleCourseMcp(new Request(url, init), { netid: "teststudent", scope: [COURSE_READ] }, upstream),
  }));
  for (const [name, args] of [["get_cs_course_schedule", { term }], ["search_prince_articles", { query: "course offerings" }]] as const) {
    const result = await client.callTool({ name, arguments: args });
    assert.notEqual(result.isError, true, JSON.stringify(result));
    const text = result.content?.find(c => c.type === "text");
    assert.ok(text?.type === "text");
    const data = JSON.parse(text.text);
    console.log(JSON.stringify({ tool: name, status: "PASS", source: data.source, sourceUrl: data.sourceUrl, fetchedAt: data.fetchedAt, coverage: data.coverage, resultCount: data.courses?.length ?? data.articles?.length, sample: data.courses?.find((c: any) => c.code === "COS217") ?? data.articles?.[0] }));
  }
} finally { await client.close(); }
