import type { WorkflowContext } from "./workflow-context.js";
import type { WorkflowState } from "./workflow-state.js";

/**
 * WorkflowStep — one unit of work in a pipeline.
 *
 * A step looks a lot like an agent (it has an `execute`), but a step is the
 * thing the ENGINE runs, whereas an agent is the thing that does the domain
 * work. Later, a step will simply wrap an agent. Keeping them separate means the
 * engine never needs to know what an agent actually is.
 *
 * Generic over its input/output so any kind of work fits the same shape.
 */
export interface WorkflowStep<TInput, TOutput> {
  /** Stable id, unique within a workflow (e.g. "research"). */
  readonly id: string;
  /** Human-friendly name for logs. */
  readonly name: string;
  /**
   * The workflow state this step represents, if any. When set, the engine asks
   * the state machine to validate the transition before running the step.
   */
  readonly state?: WorkflowState;
  /** Do the work: receive the shared context + this step's input, return output. */
  execute(context: WorkflowContext, input: TInput): Promise<TOutput>;
}

/** A step whose specific input/output types are not known at the call site. */
export type AnyWorkflowStep = WorkflowStep<unknown, unknown>;
