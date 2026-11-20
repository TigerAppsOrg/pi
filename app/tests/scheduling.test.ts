import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createSolver } from "../src/client/scheduling/engine.ts";
import {
  DEFAULT_CONSTRAINTS,
  overlaps,
  type Constraints,
  type Plan,
  type ScheduleProblem,
  type Section,
} from "../src/client/scheduling/model.ts";
import { fromJunction } from "../src/client/scheduling/junction.ts";
import { impossible, semester } from "./fixtures/semester.ts";

const engine = await createSolver(
  await readFile(
    new URL("../src/client/scheduling/solver.wasm", import.meta.url),
  ),
);
const open: Constraints = { ...DEFAULT_CONSTRAINTS, earliest: 0, latest: 1440 };

// Independent exhaustive oracle. It builds Cartesian products without the
// engine's bitsets, MRV ordering, or lower-bound pruning.
function brute(problem: ScheduleProblem, c: Constraints): Plan[] {
  let products: Section[][] = [[]];
  for (const g of problem.groups)
    products = products.flatMap((p) => g.options.map((o) => [...p, o]));
  const plans: Array<Plan & { order: number[] }> = [];
  for (const picks of products) {
    if (
      picks.some(
        (p, i) =>
          (c.locks[problem.groups[i].id] &&
            c.locks[problem.groups[i].id] !== p.id) ||
          p.status === "canceled" ||
          (!c.allowClosed && p.status === "closed"),
      )
    )
      continue;
    const meetings = picks.flatMap((p) => p.meetings);
    if (
      meetings.some(
        (m) =>
          m.start < c.earliest ||
          m.end > c.latest ||
          m.days & c.offDays ||
          c.busy.some((b) => overlaps(m, b)),
      )
    )
      continue;
    if (
      meetings.some((a, i) => meetings.slice(i + 1).some((b) => overlaps(a, b)))
    )
      continue;
    let gaps = 0,
      days = 0,
      earliest = 1440,
      latest = 0;
    for (let d = 0; d < 7; d++) {
      const today = meetings
        .filter((m) => m.days & (1 << d))
        .sort((a, b) => a.start - b.start);
      if (!today.length) continue;
      days++;
      for (let i = 1; i < today.length; i++)
        gaps += today[i].start - today[i - 1].end;
      earliest = Math.min(earliest, today[0].start);
      latest = Math.max(latest, today.at(-1)!.end);
    }
    const changes = picks.filter(
      (p, i) =>
        problem.groups[i].options.some((o) => o.selected) && !p.selected,
    ).length;
    const score =
      c.objective === "compact"
        ? gaps + days * 30
        : c.objective === "changes"
          ? changes * 20000 + gaps
          : (1440 - earliest) * 20000 + gaps;
    plans.push({
      score,
      gaps,
      days,
      earliest,
      latest,
      changes,
      picks: Object.fromEntries(
        picks.map((p, i) => [problem.groups[i].id, p.id]),
      ),
      order: picks.map((p, i) => problem.groups[i].options.indexOf(p)),
    });
  }
  return plans
    .sort(
      (a, b) =>
        a.score - b.score ||
        a.order.reduce((diff, x, i) => diff || x - b.order[i], 0),
    )
    .slice(0, 3)
    .map(({ order, ...p }) => p);
}

test("three courses sharing two slots are globally infeasible despite pairwise compatibility", () => {
  for (let i = 0; i < 3; i++)
    assert.ok(
      engine.solve(
        { ...impossible, groups: impossible.groups.filter((_, j) => j !== i) },
        open,
      ).plans.length,
    );
  assert.equal(engine.solve(impossible, open).status, "infeasible");
  const diagnosis = engine.diagnose(impossible, open);
  assert.deepEqual(
    diagnosis.groups,
    impossible.groups.map((g) => g.id),
  );
  assert.equal(diagnosis.minimal, true);
});
test("C++/Wasm top three exactly match independent exhaustive search on 300 seeded cases", () => {
  let seed = 20261105;
  const random = (n: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
  for (let trial = 0; trial < 300; trial++) {
    const problem: ScheduleProblem = {
      title: "generated",
      term: "test",
      source: "sample",
      groups: Array.from({ length: 2 + random(4) }, (_, g) => ({
        id: `g${g}`,
        course: `C${g}`,
        category: "L",
        options: Array.from({ length: 1 + random(4) }, (_, o) => {
          const start = 480 + random(8) * 60;
          return {
            id: `${g}:${o}`,
            title: `L${o}`,
            selected: o === 0,
            status: random(8) === 0 ? ("closed" as const) : ("open" as const),
            meetings: [
              { days: 1 << random(5), start, end: start + 30 + random(2) * 30 },
            ],
          };
        }),
      })),
    };
    const constraints: Constraints = {
      ...open,
      objective: (["compact", "changes", "late"] as const)[trial % 3],
      earliest: trial % 5 === 0 ? 600 : 0,
      offDays: trial % 7 === 0 ? 16 : 0,
      busy:
        trial % 3 === 0
          ? [{ id: "b", label: "practice", days: 1, start: 600, end: 700 }]
          : [],
    };
    if (trial % 4 === 0)
      constraints.locks = {
        [problem.groups[0].id]: problem.groups[0].options[0].id,
      };
    assert.deepEqual(
      engine.solve(problem, constraints).plans,
      brute(problem, constraints),
      `seeded case ${trial}`,
    );
  }
});
test("presentation fixture has exact ranked solutions and changes when Friday is protected", () => {
  for (const offDays of [0, 16]) {
    const constraints = { ...open, earliest: 600, offDays };
    const result = engine.solve(semester, constraints);
    assert.equal(result.status, "optimal");
    assert.equal(result.plans.length, 3);
    assert.deepEqual(result.plans, brute(semester, constraints));
  }
});
test("search exhaustion is reported as unfinished, never infeasible or optimal", () => {
  const result = engine.solve(semester, open, { nodes: 1 });
  assert.equal(result.status, "limited");
  assert.deepEqual(result.plans, []);
});
test("touching endpoints fit and every meeting of a multi-meeting section is checked", () => {
  const problem = structuredClone(impossible);
  problem.groups = problem.groups.slice(0, 2);
  problem.groups[0].options = [
    {
      ...problem.groups[0].options[0],
      meetings: [
        { days: 1, start: 540, end: 600 },
        { days: 2, start: 600, end: 650 },
      ],
    },
  ];
  problem.groups[1].options = [
    {
      ...problem.groups[1].options[0],
      meetings: [{ days: 1, start: 600, end: 650 }],
    },
  ];
  assert.equal(engine.solve(problem, open).status, "optimal");
  problem.groups[1].options[0].meetings[0].days = 2;
  assert.equal(engine.solve(problem, open).status, "infeasible");
});
test("a suggested relaxation has a verified full schedule", () => {
  const constraints = { ...open, earliest: 1100 };
  assert.equal(engine.solve(semester, constraints).status, "infeasible");
  const diagnosis = engine.diagnose(semester, constraints);
  assert.ok(diagnosis.relaxations.length);
  for (const fix of diagnosis.relaxations)
    assert.ok(engine.solve(semester, fix.constraints).plans.length);
});
test("canceled sections never become available and unknown lock IDs fail explicitly", () => {
  const problem = structuredClone(impossible);
  problem.groups = problem.groups.slice(0, 1);
  for (const o of problem.groups[0].options) o.status = "canceled";
  assert.equal(
    engine.solve(problem, { ...open, allowClosed: true }).status,
    "infeasible",
  );
  assert.throws(
    () => engine.solve(semester, { ...open, locks: { missing: "bad" } }),
    /no longer/,
  );
});
test("Junction adapter preserves distinct sections and multiple meetings, rejects incomplete courses", () => {
  const row = {
    courseCode: "COS 217",
    sectionTitle: "P01",
    days: ["M"],
    startTime: "9:00 AM",
    endTime: "9:50 AM",
    selected: true,
    status: "open",
  };
  const payload = {
    schedule: { title: "Fall", termName: "Fall 2026" },
    courses: [{ code: "COS217", title: "Systems" }],
    sections: [
      row,
      { ...row, days: ["W"] },
      { ...row, sectionTitle: "P02", selected: false },
    ],
  };
  const result = fromJunction(payload);
  assert.equal(result.groups[0].options.length, 2);
  assert.equal(result.groups[0].options[0].meetings.length, 2);
  assert.throws(
    () =>
      fromJunction({
        ...payload,
        courses: [
          ...payload.courses,
          { code: "MAT202", title: "Linear Algebra" },
        ],
      }),
    /no section data/,
  );
  assert.throws(
    () =>
      fromJunction({
        ...payload,
        sections: [{ ...row, startTime: "8:12.5 AM" }],
      }),
    /complete meeting/,
  );
  assert.throws(
    () => fromJunction({ ...payload, sections: [{ ...row, days: [] }] }),
    /complete meeting/,
  );
});
test("malformed and oversized inputs are rejected before crossing the Wasm boundary", () => {
  assert.throws(
    () => engine.solve({ ...semester, groups: [] }, open),
    /1 to 32/,
  );
  assert.throws(
    () => engine.solve(semester, { ...open, earliest: NaN }),
    /time range/,
  );
  assert.throws(
    () => engine.solve(semester, open, { nodes: 2147483648 }),
    /search settings/,
  );
});
