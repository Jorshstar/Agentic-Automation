/**
 * ExecutionDecision — what the DecisionEngine says should happen next, after a
 * node has been handled. It is pure data (a verdict + reason), decided by rules;
 * the strategy is what actually acts on it.
 */

export type ExecutionDecisionKind =
  | "Proceed"
  | "Retry"
  | "Skip"
  | "Abort"
  // Declared but not implemented yet (selecting one throws NotImplementedError).
  | "InsertNode"
  | "ReplaceNode"
  | "Branch";

export interface ExecutionDecision {
  /** The verdict. */
  readonly kind: ExecutionDecisionKind;
  /** Why this verdict was reached (great for the decision history/log). */
  readonly reason: string;
  /** The node the decision is about, if any. */
  readonly nodeId?: string;
}
