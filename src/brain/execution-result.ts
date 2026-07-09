import type { ExecutionContext } from "./execution-context.js";
import type { ExecutionStatus } from "./node-state.js";
import type { ExecutionDecision } from "./execution-decision.js";
import type { PipelineData } from "../pipeline/pipeline-data.js";

/**
 * ExecutionResult — what `Brain.execute(goal)` returns now that the Brain runs
 * the plan. It reports how the run ended and hands back the full state so the
 * caller can inspect everything that happened.
 */
export interface ExecutionResult {
  /** How the run ended overall. */
  readonly status: ExecutionStatus;
  /** Ids of nodes that completed successfully, in completion order. */
  readonly completedNodes: readonly string[];
  /** Ids of nodes that failed. */
  readonly failedNodes: readonly string[];
  /** The full run state (goal, plan, node states, variables, event log). */
  readonly context: ExecutionContext;
  /** The final PipelineData after all executed agents. */
  readonly pipelineData: PipelineData;
  /** Every decision the DecisionEngine made during the run, in order. */
  readonly decisionHistory: readonly ExecutionDecision[];
}
