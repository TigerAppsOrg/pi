import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { cpus } from "node:os";
import { createSolver } from "../src/client/scheduling/engine.ts";
import { DEFAULT_CONSTRAINTS } from "../src/client/scheduling/model.ts";
import { impossible, semester } from "../tests/fixtures/semester.ts";

const bytes = await readFile(
  new URL("../src/client/scheduling/solver.wasm", import.meta.url),
);
const source = await readFile(new URL("../solver/schedule.cpp", import.meta.url));
const engine = await createSolver(bytes);
const warmup = 100;
const samples = 1000;
const constraints = { ...DEFAULT_CONSTRAINTS, earliest: 600, latest: 1440 };
const workloads = [
  { name: "compact semester", problem: semester, constraints },
  {
    name: "compact semester with Friday free",
    problem: semester,
    constraints: { ...constraints, offDays: 16 },
  },
  {
    name: "three groups in two slots",
    problem: impossible,
    constraints: { ...DEFAULT_CONSTRAINTS, earliest: 0, latest: 1440 },
  },
];

const results = workloads.map(({ name, problem, constraints }) => {
  const expected = engine.solve(problem, constraints);
  assert.equal(expected.status, problem === impossible ? "infeasible" : "optimal");
  for (let i = 0; i < warmup; i++) engine.solve(problem, constraints);
  const durations: number[] = [];
  let checksum = 0;
  for (let i = 0; i < samples; i++) {
    const start = performance.now();
    const result = engine.solve(problem, constraints);
    durations.push(performance.now() - start);
    // Consume and validate outside the timed interval.
    assert.equal(result.status, expected.status);
    assert.deepEqual(result.plans, expected.plans);
    checksum += result.nodes + result.plans.reduce((sum, plan) => sum + plan.score, 0);
  }
  durations.sort((a, b) => a - b);
  const percentile = (p: number) => durations[Math.ceil(p * samples) - 1];
  return {
    name,
    groups: problem.groups.length,
    options: problem.groups.reduce((sum, group) => sum + group.options.length, 0),
    status: expected.status,
    plans: expected.plans.length,
    nodes: expected.nodes,
    medianMs: (durations[samples / 2 - 1] + durations[samples / 2]) / 2,
    p95Ms: percentile(0.95),
    minMs: durations[0],
    maxMs: durations[samples - 1],
    checksum,
  };
});

console.log(JSON.stringify({
  node: process.versions.node,
  platform: process.platform,
  architecture: process.arch,
  cpu: cpus()[0]?.model,
  wasmSha256: createHash("sha256").update(bytes).digest("hex"),
  sourceSha256: createHash("sha256").update(source).digest("hex"),
  warmup,
  samples,
  boundary: "Warm engine.solve including JS validation, encoding, Wasm, and decoding",
  excludes: "Compilation, instantiation, workers, conflict diagnosis, rendering",
  limitations: "Repeated synthetic fixtures. No production tail-latency or speedup claim.",
  results,
}, null, 2));
