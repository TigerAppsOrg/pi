import assert from "node:assert/strict";
import { test } from "node:test";
import { streamText } from "ai";
import { NOTICE_MODEL_ID, noticeModel } from "../src/server/notice-model.ts";
import {
  DEFAULT_BUDGET,
  WEEK_MS,
  budgetFrom,
  formatReset,
  limitNote,
  usageStatus,
} from "../src/shared/usage-limit.ts";

const DAY = 24 * 60 * 60 * 1000;
// Wed, Oct 14 2026, 3:10 PM in Princeton (19:10 UTC, daylight time).
const now = Date.UTC(2026, 9, 14, 19, 10);

test("under $3 a student can use any model", () => {
  const s = usageStatus([{ at: now - DAY, usd: 1.25 }], now);
  assert.equal(s.tier, 1);
  assert.equal(s.blocked, false);
  assert.equal(s.spentUsd, 1.25);
  assert.equal(s.limitUsd, 4);
  assert.equal(s.percentUsed, 31.3);
  assert.equal(s.resetAt, null);
  assert.equal(limitNote(s), null);
});

test("past $3 it's Sonnet only, until enough old spend ages out", () => {
  const spends = [
    { at: now - 5 * DAY, usd: 2 },
    { at: now - 2 * DAY, usd: 1.2 },
  ];
  const s = usageStatus(spends, now);
  assert.equal(s.tier, 2);
  assert.equal(s.blocked, false);
  // Dropping the $2 turn leaves $1.20, back under $3.
  assert.equal(s.resetAt, now - 5 * DAY + WEEK_MS);
  assert.match(limitNote(s)!, /^You've used this week's Opus budget, so PI is answering with Sonnet 5 until Fri, Oct 16, 3:10 PM\.$/);
});

test("at $4 PI stops answering until the week rolls over far enough", () => {
  const spends = [
    { at: now - 6 * DAY, usd: 0.5 },
    { at: now - 4 * DAY, usd: 0.25 },
    { at: now - 3 * DAY, usd: 3.5 },
  ];
  const s = usageStatus(spends, now);
  assert.equal(s.tier, "exhausted");
  assert.equal(s.blocked, true);
  assert.equal(s.percentUsed, 100);
  // $4.25 total: losing the $0.50 turn leaves $3.75, under $4.
  assert.equal(s.resetAt, now - 6 * DAY + WEEK_MS);
  assert.match(limitNote(s)!, /^You've used this week's PI allowance\. It frees up Thu, Oct 15, 3:10 PM\.$/);
});

test("only the last seven days count", () => {
  const s = usageStatus(
    [
      { at: now - WEEK_MS, usd: 10 },
      { at: now - WEEK_MS - DAY, usd: 10 },
      { at: now + DAY, usd: 10 },
      { at: now - 1, usd: 0.5 },
    ],
    now
  );
  assert.equal(s.spentUsd, 0.5);
  assert.equal(s.tier, 1);
});

test("budget amounts come from Worker vars, with PrincetonCourses' numbers as the default", () => {
  assert.deepEqual(budgetFrom({}), DEFAULT_BUDGET);
  assert.deepEqual(budgetFrom({ USAGE_TIER1_USD: "5", USAGE_TIER2_USD: "2.5" }), {
    tier1Usd: 5,
    tier2Usd: 2.5,
    windowMs: WEEK_MS,
  });
  assert.equal(budgetFrom({ USAGE_TIER1_USD: "", USAGE_TIER2_USD: "-1" }).tier1Usd, 3);
  assert.equal(budgetFrom({ USAGE_TIER2_USD: "lots" }).tier2Usd, 1);
  assert.equal(budgetFrom({ USAGE_TIER2_USD: "0" }).tier2Usd, 0);
});

test("reset times read in Princeton's time zone", () => {
  assert.equal(formatReset(now), "Wed, Oct 14, 3:10 PM");
});

test("the stand-in model answers with the note and costs nothing", async () => {
  const note = "You've used this week's PI allowance. It frees up Thu, Oct 15, 3:10 PM.";
  const result = streamText({ model: noticeModel(note), prompt: "what's open at Whitman" });
  let text = "";
  for await (const part of result.fullStream) {
    if (part.type === "text-delta") text += part.text;
  }
  assert.equal(text, note);
  const usage = await result.usage;
  assert.equal(usage.inputTokens, 0);
  assert.equal(usage.outputTokens, 0);
  assert.equal((await result.response).modelId, NOTICE_MODEL_ID);
});
