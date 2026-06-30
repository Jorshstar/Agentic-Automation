import type { AnyWorkflowStep } from "./workflow-step.js";

/**
 * WorkflowDefinition — a named, ordered list of steps.
 *
 * That's all a "workflow" is: a recipe. The engine reads this recipe and runs
 * the steps top to bottom. Nothing here is specific to video, research, or
 * scripts — any future workflow can be described with this same shape and run by
 * the same engine.
 */
export interface WorkflowDefinition {
  /** Stable id for the workflow (e.g. "daily-video"). */
  readonly id: string;
  /** Human-friendly name for logs. */
  readonly name: string;
  /** The steps to run, in order. */
  readonly steps: readonly AnyWorkflowStep[];
}
