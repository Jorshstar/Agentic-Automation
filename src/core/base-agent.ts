import type { WorkflowContext } from "./workflow-context.js";

/**
 * BaseAgent — the single contract EVERY agent in the system follows.
 *
 * It is generic over its input (`TInput`) and output (`TOutput`), so each agent
 * decides exactly what data it needs and what it returns, while still sharing
 * the same `execute()` shape. That uniformity is what lets the orchestrator run
 * any agent the same way (composition over inheritance — agents are plugged in,
 * not subclassed).
 *
 * @typeParam TInput  what the agent needs to do its job
 * @typeParam TOutput what the agent produces
 */
export interface BaseAgent<TInput, TOutput> {
  /** Stable identifier for logs/metrics (e.g. "script-agent"). */
  readonly name: string;

  /**
   * Run the agent.
   * @param context the shared workflow context (correlationId, niche, logger...)
   * @param input   the agent-specific input
   * @returns       a promise resolving to the agent-specific output
   */
  execute(context: WorkflowContext, input: TInput): Promise<TOutput>;
}

/** Helper: any agent, when the specific input/output types don't matter. */
export type AnyAgent = BaseAgent<unknown, unknown>;
