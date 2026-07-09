import type { ExecutionContext } from "./execution-context.js";
import type { ExecutionResult } from "./execution-result.js";

/**
 * ExecutionStrategy — HOW a plan gets executed.
 *
 * The Brain depends only on this interface (just like it depends on the Planner
 * interface). It calls `strategy.execute(context)` and gets back a result — it
 * has no idea whether execution is sequential, parallel, distributed, or cloud.
 * Swapping strategies never touches the Brain.
 */
export interface ExecutionStrategy {
  /** Stable name for logs/observability (e.g. "sequential-execution-strategy"). */
  readonly name: string;
  /** Run the plan held by the context and return the result. */
  execute(context: ExecutionContext): Promise<ExecutionResult>;
}
