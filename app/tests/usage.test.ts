import assert from "node:assert/strict";
import { test } from "node:test";
import { addStep, costUsd, emptyTurnUsage, pseudonym } from "../src/server/usage.ts";

// One Anthropic step as the AI SDK reports it: 1,000 uncached input tokens,
// 8,000 read from cache, 2,000 written (500 of them with the 1-hour TTL),
// 300 output of which 100 were reasoning, and two web searches.
const step = {
  inputTokens: 11_000,
  inputTokenDetails: { noCacheTokens: 1_000, cacheReadTokens: 8_000, cacheWriteTokens: 2_000 },
  outputTokens: 300,
  outputTokenDetails: { reasoningTokens: 100 },
  raw: {
    input_tokens: 1_000,
    server_tool_use: { web_search_requests: 2 },
    cache_creation: { ephemeral_5m_input_tokens: 1_500, ephemeral_1h_input_tokens: 500 },
  },
};

test("a step's tokens land in the right buckets", () => {
  assert.deepEqual(addStep(emptyTurnUsage(), step), {
    steps: 1,
    input: 1_000,
    cacheRead: 8_000,
    cacheWrite5m: 1_500,
    cacheWrite1h: 500,
    output: 300,
    reasoning: 100,
    webSearches: 2,
  });
});

test("a turn's cost is every step priced at its own rate", () => {
  const turn = addStep(addStep(emptyTurnUsage(), step), step);
  assert.equal(turn.steps, 2);
  // Per step on Opus 5: 1,000 x $5 + 8,000 x $0.50 + 1,500 x $6.25
  // + 500 x $10 + 300 x $25 = $30,875 per million tokens, plus $0.02 of search.
  assert.ok(Math.abs(costUsd("claude-opus-5", turn)! - 2 * (0.030875 + 0.02)) < 1e-12);
  // Sonnet 5: 1,000 x $2 + 8,000 x $0.20 + 1,500 x $2.50 + 500 x $4 + 300 x $10.
  assert.ok(Math.abs(costUsd("claude-sonnet-5", addStep(emptyTurnUsage(), step))! - (0.01235 + 0.02)) < 1e-12);
});

test("missing detail falls back sensibly and never goes negative", () => {
  const plain = addStep(emptyTurnUsage(), { inputTokens: 4_000, outputTokens: 50 });
  assert.equal(plain.input, 4_000);
  assert.equal(plain.cacheWrite5m, 0);
  assert.equal(plain.webSearches, 0);

  const derived = addStep(emptyTurnUsage(), {
    inputTokens: 4_000,
    inputTokenDetails: { cacheReadTokens: 3_000 },
  });
  assert.equal(derived.input, 1_000);

  const empty = addStep(emptyTurnUsage(), undefined);
  assert.equal(empty.steps, 1);
  assert.equal(costUsd("claude-opus-5", empty), 0);
});

test("an unpriced model reads as unknown, not free", () => {
  assert.equal(costUsd("claude-mystery-9", addStep(emptyTurnUsage(), step)), null);
});

test("student ids in the logs are stable, short and not the NetID", async () => {
  const a = await pseudonym("aj5828", "secret-one");
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.equal(await pseudonym("aj5828", "secret-one"), a);
  assert.notEqual(await pseudonym("aj5828", "secret-two"), a);
  assert.notEqual(await pseudonym("ab1234", "secret-one"), a);
  assert.ok(!a.includes("aj5828"));
});
