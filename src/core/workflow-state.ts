/**
 * Workflow state — the named "stage" a video run is currently in.
 *
 * We declare a `const` (for runtime values like `WorkflowState.Researching`)
 * AND a `type` of the same name (for typing variables). TypeScript happily lets
 * a value and a type share a name, which gives us enum-like ergonomics without
 * the downsides of `enum`. Add a new stage by adding one line — it stays
 * extensible.
 */
export const WorkflowState = {
  Pending: "pending",
  Researching: "researching",
  ScriptWriting: "script-writing",
  ScriptReview: "script-review",
  VoiceGeneration: "voice-generation",
  VisualGeneration: "visual-generation",
  VideoAssembly: "video-assembly",
  QualityReview: "quality-review",
  Storage: "storage",
  Notification: "notification",
  Completed: "completed",
  Failed: "failed",
} as const;

/** Union of every valid state value, e.g. "researching" | "completed" | ... */
export type WorkflowState = (typeof WorkflowState)[keyof typeof WorkflowState];

/** States after which a workflow is finished and will not advance further. */
export const TERMINAL_WORKFLOW_STATES = [
  WorkflowState.Completed,
  WorkflowState.Failed,
] as const satisfies readonly WorkflowState[];

/** True if the workflow has reached a final state (completed or failed). */
export function isTerminalWorkflowState(state: WorkflowState): boolean {
  return (TERMINAL_WORKFLOW_STATES as readonly WorkflowState[]).includes(state);
}
