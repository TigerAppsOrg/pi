import assert from "node:assert/strict";
import { test } from "node:test";
import { dictationProblem, joinDictation, transcriptOf } from "../src/client/lib/dictation.ts";

test("dictation continues what was typed and never rewrites it", () => {
  assert.equal(joinDictation("", "  when is COS 226  "), "when is COS 226");
  assert.equal(joinDictation("Compare", "ORF 309 and ORF 405"), "Compare ORF 309 and ORF 405");
  assert.equal(joinDictation("Compare ", "ORF 309"), "Compare ORF 309");
  assert.equal(joinDictation("keep this", "   "), "keep this");
  assert.equal(joinDictation("a", "two\n  lines"), "a two lines");
});

test("the transcript joins every result, settled or still settling", () => {
  const results = [[{ transcript: "what's open " }], [{ transcript: "at Whitman" }], []];
  assert.equal(transcriptOf(results), "what's open at Whitman");
  assert.equal(transcriptOf([]), "");
});

test("recognizer failures read as something a student can act on", () => {
  assert.match(dictationProblem("not-allowed")!, /blocking the microphone/);
  assert.match(dictationProblem("service-not-allowed")!, /blocking the microphone/);
  assert.match(dictationProblem("audio-capture")!, /microphone/);
  assert.equal(dictationProblem("no-speech"), null);
  assert.equal(dictationProblem("aborted"), null);
  assert.ok(dictationProblem("something-new"));
});
