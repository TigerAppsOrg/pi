import { useEffect, useState } from "react";
import SolverWorker from "./worker?worker&inline";
import type {
  Constraints,
  Diagnosis,
  ScheduleProblem,
  SolveResult,
} from "./model";

export type SearchState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "done"; result: SolveResult; diagnosis?: Diagnosis };

export function useSolver(
  problem: ScheduleProblem,
  constraints: Constraints,
): SearchState {
  const [snapshot, setSnapshot] = useState<{
    problem: ScheduleProblem;
    constraints: Constraints;
    state: SearchState;
  } | null>(null);
  useEffect(() => {
    let current = true;
    const setState = (state: SearchState) => {
      if (current) setSnapshot({ problem, constraints, state });
    };
    // A fresh worker cancels any obsolete search, including conflict analysis.
    // Main-thread interaction never waits for a long combinatorial search.
    const worker = new SolverWorker();
    worker.onmessage = ({ data }) => {
      setState(
        data.error
          ? { kind: "error", message: data.error }
          : { kind: "done", ...data },
      );
    };
    worker.onerror = () =>
      setState({
        kind: "error",
        message: "The planner engine could not start. Refresh and try again.",
      });
    worker.postMessage({ problem, constraints, explain: true });
    return () => {
      current = false;
      worker.terminate();
    };
  }, [problem, constraints]);
  return snapshot?.problem === problem && snapshot.constraints === constraints
    ? snapshot.state
    : { kind: "loading" };
}
