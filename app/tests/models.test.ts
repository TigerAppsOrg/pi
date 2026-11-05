import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SETTINGS, PI_MODELS, resolveModel } from "../src/shared/apps.ts";
import { modelForBudget, usageStatus } from "../src/shared/usage-limit.ts";

test("Sonnet 5.5 is the default for new and retired model preferences", () => {
  assert.equal(DEFAULT_SETTINGS.model, "claude-sonnet-5-5");
  for (const preference of [undefined, null, "campus", "claude-sonnet-5", "unknown"]) {
    assert.equal(resolveModel(preference), "claude-sonnet-5-5");
  }
});

test("the picker and model resolver preserve Haiku and existing Opus choices", () => {
  assert.ok(PI_MODELS.some((model) => model.value === "claude-haiku-5-5"));
  assert.equal(resolveModel("claude-haiku-5-5"), "claude-haiku-5-5");
  assert.equal(resolveModel("claude-opus-5"), "claude-opus-5");
  for (const model of PI_MODELS) assert.equal(resolveModel(model.value), model.value);
});

test("tier two downgrades Opus to Sonnet 5.5 without upgrading Haiku", () => {
  const status = usageStatus([{ at: 1, usd: 3.25 }], 2);
  assert.equal(status.tier, 2);
  assert.equal(modelForBudget("claude-opus-5", status), "claude-sonnet-5-5");
  assert.equal(modelForBudget("claude-sonnet-5-5", status), "claude-sonnet-5-5");
  assert.equal(modelForBudget("claude-haiku-5-5", status), "claude-haiku-5-5");
  assert.equal(modelForBudget("claude-opus-5", usageStatus([], 2)), "claude-opus-5");
  assert.equal(modelForBudget("claude-haiku-5-5", null), "claude-haiku-5-5");
});
