import assert from "node:assert/strict";
import { test } from "node:test";
import { withCacheBreakpoints, type Prompt } from "../src/server/prompt-cache.ts";

const bp = (m: Prompt[number]) =>
  (m.providerOptions?.anthropic as { cacheControl?: { type: string } } | undefined)?.cacheControl?.type;

const user = (text: string): Prompt[number] => ({ role: "user", content: [{ type: "text", text }] });
const assistant = (text: string): Prompt[number] => ({ role: "assistant", content: [{ type: "text", text }] });

test("a turn gets a breakpoint on the system prompt and one on the last message", () => {
  const out = withCacheBreakpoints([
    { role: "system", content: "You are PI." },
    user("what's due this week"),
    assistant("Let me check."),
    user("thanks"),
  ]);
  assert.deepEqual(out.map(bp), ["ephemeral", undefined, undefined, "ephemeral"]);
});

test("several system messages: only the last one is marked, so the whole prefix is one cache entry", () => {
  const out = withCacheBreakpoints([
    { role: "system", content: "Stable rules." },
    { role: "system", content: "Workspace note." },
    user("hi"),
  ]);
  assert.deepEqual(out.map(bp), [undefined, "ephemeral", "ephemeral"]);
});

test("a tool result at the end of a step is the rolling breakpoint", () => {
  const out = withCacheBreakpoints([
    { role: "system", content: "You are PI." },
    user("search"),
    { role: "assistant", content: [{ type: "tool-call", toolCallId: "1", toolName: "find", input: {} }] },
    { role: "tool", content: [{ type: "tool-result", toolCallId: "1", toolName: "find", output: { type: "text", value: "x" } }] },
  ]);
  assert.deepEqual(out.map(bp), ["ephemeral", undefined, undefined, "ephemeral"]);
});

test("existing breakpoints are kept and never doubled, other provider options survive", () => {
  const marked: Prompt[number] = {
    role: "user",
    content: [{ type: "text", text: "pinned" }],
    providerOptions: { anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } }, other: { a: 1 } },
  };
  const out = withCacheBreakpoints([{ role: "system", content: "s" }, marked]);
  assert.deepEqual(out[1].providerOptions, marked.providerOptions);
  const twice = withCacheBreakpoints(out);
  assert.deepEqual(twice, out);
});

test("a system-only or empty prompt is left sane", () => {
  assert.deepEqual(withCacheBreakpoints([]), []);
  const out = withCacheBreakpoints([{ role: "system", content: "s" }]);
  assert.deepEqual(out.map(bp), ["ephemeral"]);
});

test("the input prompt is not mutated", () => {
  const input: Prompt = [{ role: "system", content: "s" }, user("u")];
  const snapshot = JSON.stringify(input);
  withCacheBreakpoints(input);
  assert.equal(JSON.stringify(input), snapshot);
});
