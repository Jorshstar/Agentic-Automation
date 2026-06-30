import { WorkflowState } from "./workflow-state.js";
import { BaseError, type ErrorContext } from "../lib/errors.js";

/**
 * State machine — the rules for moving between workflow states.
 *
 * Think of it as a one-way road: you can only move to the NEXT stage in the
 * happy path, or jump to `failed` from any active stage. Trying any other move
 * throws a typed error, so an out-of-order pipeline is caught immediately rather
 * than producing a corrupt run.
 *
 * The engine asks this module to validate every state change — it never flips
 * states on its own.
 */

/** Thrown when code attempts a move the state machine does not allow. */
export class InvalidStateTransitionError extends BaseError {
  readonly code = "INVALID_STATE_TRANSITION";
  readonly retryable = false;
}

/**
 * The happy-path order of states. Reorder/extend this single array to change the
 * pipeline — `canTransition` derives the rules from it automatically.
 */
export const WORKFLOW_SEQUENCE: readonly WorkflowState[] = [
  WorkflowState.Pending,
  WorkflowState.Researching,
  WorkflowState.ScriptWriting,
  WorkflowState.ScriptReview,
  WorkflowState.VoiceGeneration,
  WorkflowState.VisualGeneration,
  WorkflowState.VideoAssembly,
  WorkflowState.QualityReview,
  WorkflowState.Storage,
  WorkflowState.Notification,
  WorkflowState.Completed,
];

/** The state that follows `state` in the happy path, or null if there is none. */
export function nextState(state: WorkflowState): WorkflowState | null {
  const index = WORKFLOW_SEQUENCE.indexOf(state);
  if (index === -1 || index === WORKFLOW_SEQUENCE.length - 1) {
    return null;
  }
  return WORKFLOW_SEQUENCE[index + 1] ?? null;
}

/** True if moving from `from` to `to` is allowed. */
export function canTransition(from: WorkflowState, to: WorkflowState): boolean {
  // Terminal states never move on.
  if (from === WorkflowState.Completed || from === WorkflowState.Failed) {
    return false;
  }
  // Any active state may fail.
  if (to === WorkflowState.Failed) {
    return true;
  }
  // Otherwise only the immediate next state is allowed.
  return nextState(from) === to;
}

/** Validate a transition, throwing {@link InvalidStateTransitionError} if invalid. */
export function assertTransition(from: WorkflowState, to: WorkflowState): void {
  if (!canTransition(from, to)) {
    const context: ErrorContext = { from, to };
    throw new InvalidStateTransitionError(
      `Invalid workflow transition: "${from}" → "${to}"`,
      context,
    );
  }
}
