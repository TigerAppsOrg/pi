import assert from "node:assert/strict";
import { test } from "node:test";
import { extractWebSearch, parseToolPart, sourceName } from "../src/client/lib/tools.ts";

const results = [
  { type: "web_search_result", url: "https://www.cs.princeton.edu/ugrad/courses", title: "Courses | Princeton CS", pageAge: null, encryptedContent: "x" },
  { type: "web_search_result", url: "https://www.cs.princeton.edu/ugrad/courses", title: "duplicate", pageAge: null, encryptedContent: "x" },
  { type: "web_search_result", url: "https://registrar.princeton.edu/calendar", title: "  ", pageAge: null, encryptedContent: "x" },
  { type: "web_search_result", url: "javascript:alert(1)", title: "bad", pageAge: null, encryptedContent: "x" },
  { type: "web_search_result", url: "not a url", title: "bad", pageAge: null, encryptedContent: "x" },
];

test("a web search part becomes its query and deduplicated, linkable pages", () => {
  const view = parseToolPart({
    type: "tool-web_search",
    state: "output-available",
    providerExecuted: true,
    input: { query: " fall break dates 2026 " },
    output: results,
  })!;
  const search = extractWebSearch(view)!;
  assert.equal(search.query, "fall break dates 2026");
  assert.deepEqual(search.results, [
    { url: "https://www.cs.princeton.edu/ugrad/courses", title: "Courses | Princeton CS", site: "cs.princeton.edu" },
    { url: "https://registrar.princeton.edu/calendar", title: "registrar.princeton.edu", site: "registrar.princeton.edu" },
  ]);
  assert.equal(sourceName(view), "The web");
});

test("a failed or still-running search has no pages, and other tools are not web searches", () => {
  const failed = parseToolPart({
    type: "tool-web_search",
    state: "output-error",
    input: {},
    errorText: "max_uses_exceeded",
  })!;
  assert.deepEqual(extractWebSearch(failed), { query: null, results: [] });

  const running = parseToolPart({ type: "tool-web_search", state: "input-streaming" })!;
  assert.deepEqual(extractWebSearch(running), { query: null, results: [] });

  const course = parseToolPart({ type: "tool-tool_junction_search_courses", state: "output-available", output: [] })!;
  assert.equal(extractWebSearch(course), null);
  assert.equal(sourceName(course), "TigerJunction");
});
