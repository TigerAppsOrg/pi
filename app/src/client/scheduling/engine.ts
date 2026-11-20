import {
  type Constraints,
  type Diagnosis,
  type Plan,
  type ScheduleProblem,
  type SolveResult,
  type TimeSlot,
  DAYS,
  overlaps,
  timeLabel,
} from "./model";

const MAGIC = 0x50495331;
type Exports = {
  memory: WebAssembly.Memory;
  solver_input(): number;
  solver_output(): number;
  solver_capacity(): number;
  solver_run(length: number): number;
};
type Limits = { nodes?: number; first?: boolean; top?: number };
function checkSlot(s: TimeSlot) {
  if (
    ![s.days, s.start, s.end].every(Number.isInteger) ||
    s.days < 1 ||
    s.days > 127 ||
    s.start < 0 ||
    s.end > 1440 ||
    s.start >= s.end
  )
    throw new Error(
      "Every section needs valid days and complete meeting times.",
    );
}

export async function createSolver(bytes: BufferSource) {
  const module = await WebAssembly.compile(bytes);
  const instance = await WebAssembly.instantiate(module, {});
  const wasm = instance.exports as unknown as Exports;

  function solve(
    problem: ScheduleProblem,
    constraints: Constraints,
    limits: Limits = {},
  ): SolveResult {
    const start = performance.now();
    const groups = problem.groups;
    if (!groups.length || groups.length > 32)
      throw new Error("Choose a schedule with 1 to 32 section groups.");
    if (new Set(groups.map((g) => g.id)).size !== groups.length)
      throw new Error("Section group identifiers must be unique.");
    const options = groups.flatMap((g) => g.options);
    const meetings = options.flatMap((o) => o.meetings);
    if (
      !options.length ||
      options.length > 512 ||
      meetings.length > 2048 ||
      constraints.busy.length > 64
    )
      throw new Error("This schedule exceeds the planner's supported size.");
    if (
      ![constraints.earliest, constraints.latest, constraints.offDays].every(
        Number.isInteger,
      ) ||
      constraints.earliest < 0 ||
      constraints.latest > 1440 ||
      constraints.earliest > constraints.latest ||
      constraints.offDays < 0 ||
      constraints.offDays > 127
    )
      throw new Error("Check the time range and days off.");
    const objective = ["compact", "changes", "late"].indexOf(
      constraints.objective,
    );
    const nodes = limits.nodes ?? 200000,
      top = limits.top ?? 3;
    if (
      objective < 0 ||
      !Number.isInteger(nodes) ||
      nodes < 1 ||
      nodes > 1000000 ||
      !Number.isInteger(top) ||
      top < 1 ||
      top > 3
    )
      throw new Error("Invalid search settings.");
    if (
      Object.keys(constraints.locks).some(
        (id) => !groups.some((g) => g.id === id),
      )
    )
      throw new Error("A locked section is no longer in this schedule.");
    const input = [
      MAGIC,
      1,
      groups.length,
      options.length,
      meetings.length,
      constraints.busy.length,
      constraints.earliest,
      constraints.latest,
      constraints.offDays,
      objective,
      nodes,
      top,
      limits.first ? 1 : 0,
      0,
      0,
      0,
    ];
    let first = 0;
    for (const group of groups) {
      if (
        !group.options.length ||
        new Set(group.options.map((o) => o.id)).size !== group.options.length
      )
        throw new Error(`${group.course} needs distinct section choices.`);
      if (group.options.filter((o) => o.selected).length > 1)
        throw new Error(
          `${group.course} has ambiguous current section selections.`,
        );
      const lock = constraints.locks[group.id];
      const local =
        lock == null ? -1 : group.options.findIndex((o) => o.id === lock);
      if (lock != null && local < 0)
        throw new Error(
          `The locked section for ${group.course} is no longer available.`,
        );
      input.push(first, group.options.length, local < 0 ? -1 : first + local);
      first += group.options.length;
    }
    let meeting = 0;
    for (let gi = 0; gi < groups.length; gi++)
      for (const option of groups[gi].options) {
        if (!option.meetings.length)
          throw new Error(
            `${groups[gi].course} ${option.title} has no complete meeting times.`,
          );
        if (!["open", "closed", "canceled"].includes(option.status))
          throw new Error("Section availability was not provided.");
        for (let i = 0; i < option.meetings.length; i++) {
          checkSlot(option.meetings[i]);
          if (
            option.meetings
              .slice(i + 1)
              .some((s) => overlaps(s, option.meetings[i]))
          )
            throw new Error(
              `${groups[gi].course} ${option.title} contains overlapping meeting records.`,
            );
        }
        const enabled =
          option.status === "open" ||
          (constraints.allowClosed && option.status === "closed");
        input.push(
          gi,
          meeting,
          option.meetings.length,
          option.selected ? 1 : 0,
          enabled ? 1 : 0,
        );
        meeting += option.meetings.length;
      }
    for (const slot of [...meetings, ...constraints.busy]) {
      checkSlot(slot);
      input.push(slot.days, slot.start, slot.end);
    }
    if (input.length > wasm.solver_capacity())
      throw new Error("This schedule exceeds the solver's input capacity.");
    new Int32Array(wasm.memory.buffer, wasm.solver_input(), input.length).set(
      input,
    );
    const status = wasm.solver_run(input.length);
    if (status === 3)
      throw new Error("The solver rejected incomplete schedule data.");
    const output = new Int32Array(
      wasm.memory.buffer,
      wasm.solver_output(),
      256,
    );
    if (output[0] !== MAGIC || output[1] !== 1 || output[5] !== groups.length)
      throw new Error("The planner engine version does not match this page.");
    const plans: Plan[] = [];
    let at = 8;
    for (let i = 0; i < output[3]; i++) {
      const [score, gaps, days, earliest, changes, latest] = output.slice(
        at,
        at + 6,
      );
      at += 6;
      const picks: Record<string, string> = {};
      for (const group of groups) picks[group.id] = options[output[at++]].id;
      plans.push({ score, gaps, days, earliest, changes, latest, picks });
    }
    return {
      status:
        status === 0 ? "optimal" : status === 1 ? "infeasible" : "limited",
      plans,
      nodes: output[4],
      solveMs: performance.now() - start,
    };
  }

  // Deletion-based irreducible conflict, with its own finite work budget.
  // Unknown subproblems are kept. We never call a bounded-out search a proof.
  function diagnose(
    problem: ScheduleProblem,
    constraints: Constraints,
  ): Diagnosis {
    let core = [...problem.groups],
      minimal = true;
    for (const group of problem.groups) {
      if (core.length === 1) break;
      const trial = core.filter((g) => g.id !== group.id);
      const locks = Object.fromEntries(
        Object.entries(constraints.locks).filter(([id]) =>
          trial.some((g) => g.id === id),
        ),
      );
      const result = solve(
        { ...problem, groups: trial },
        { ...constraints, locks },
        { nodes: 20000, first: true },
      );
      if (result.status === "infeasible") core = trial;
      else if (!result.plans.length) minimal = false;
    }
    const candidates: Diagnosis["relaxations"] = [];
    if (constraints.earliest > 0)
      candidates.push({
        label: `Allow classes before ${timeLabel(constraints.earliest)}`,
        constraints: { ...constraints, earliest: 0 },
      });
    if (constraints.latest < 1440)
      candidates.push({
        label: `Allow classes after ${timeLabel(constraints.latest)}`,
        constraints: { ...constraints, latest: 1440 },
      });
    for (let d = 0; d < 7; d++)
      if (constraints.offDays & (1 << d))
        candidates.push({
          label: `Allow classes on ${DAYS[d]}`,
          constraints: {
            ...constraints,
            offDays: constraints.offDays & ~(1 << d),
          },
        });
    for (const [id, option] of Object.entries(constraints.locks)) {
      const group = problem.groups.find((g) => g.id === id)!;
      const locks = { ...constraints.locks };
      delete locks[id];
      candidates.push({
        label: `Unlock ${group.course} ${group.options.find((o) => o.id === option)?.title ?? group.category}`,
        constraints: { ...constraints, locks },
      });
    }
    for (const block of constraints.busy)
      candidates.push({
        label: `Remove ${block.label}`,
        constraints: {
          ...constraints,
          busy: constraints.busy.filter((b) => b.id !== block.id),
        },
      });
    if (!constraints.allowClosed)
      candidates.push({
        label: "Include full sections",
        constraints: { ...constraints, allowClosed: true },
      });
    const relaxations = candidates
      .slice(0, 24)
      .filter(
        (c) =>
          solve(problem, c.constraints, { nodes: 20000, first: true }).plans
            .length > 0,
      )
      .slice(0, 3);
    return { groups: core.map((g) => g.id), minimal, relaxations };
  }
  return { solve, diagnose };
}
