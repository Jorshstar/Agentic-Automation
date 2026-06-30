import type { WorkflowState } from "../../core/workflow-state.js";

/**
 * ExecutionMetadata — the live "where are we?" facts about the run.
 * Updated as the workflow advances through its stages.
 */
export interface ExecutionMetadata {
  readonly executionId: string;
  readonly correlationId: string;
  /** When the run started (ISO 8601). */
  readonly startedAt: string;
  /** When the pipeline was last updated (ISO 8601). */
  readonly updatedAt: string;
  /** The stage the workflow is currently in. */
  readonly currentState: WorkflowState;
  /** Ids of steps completed so far, in order. */
  readonly completedSteps: readonly string[];
}
