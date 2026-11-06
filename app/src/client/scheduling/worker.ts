import wasmUrl from "./solver.wasm?url";
import { createSolver } from "./engine";
import type { Constraints, ScheduleProblem } from "./model";

const engine = fetch(wasmUrl)
  .then((response) => {
    if (!response.ok)
      throw new Error(
        "The planner engine could not load. Refresh to try again.",
      );
    return response.arrayBuffer();
  })
  .then(createSolver);

onmessage = async (
  event: MessageEvent<{
    problem: ScheduleProblem;
    constraints: Constraints;
    explain?: boolean;
  }>,
) => {
  try {
    const solver = await engine;
    const { problem, constraints, explain } = event.data;
    const result = solver.solve(problem, constraints);
    const diagnosis =
      result.status === "infeasible" && explain
        ? solver.diagnose(problem, constraints)
        : undefined;
    postMessage({ result, diagnosis });
  } catch (error) {
    postMessage({
      error:
        error instanceof Error
          ? error.message
          : "The planner could not finish this request.",
    });
  }
};
