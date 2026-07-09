/**
 * Execution events — the entries in the ExecutionContext's append-only log.
 *
 * They record WHAT happened during a run. The engine is agent-agnostic, so it
 * emits GENERIC per-node events (NodeStarted/NodeCompleted/NodeFailed) that carry
 * the agent's name in `data`, plus run-level ExecutionStarted/ExecutionCompleted.
 * The agent-specific names (ResearchStarted, ...) remain available for a future
 * agent-aware layer.
 */

export type ExecutionEventType =
  // Run-level + generic node lifecycle (emitted by the engine).
  | "ExecutionStarted"
  | "ExecutionCompleted"
  | "NodeStarted"
  | "NodeCompleted"
  | "NodeFailed"
  // Retry lifecycle (emitted by the NodeExecutor's retry engine).
  | "RetryScheduled"
  | "RetryStarted"
  | "RetrySucceeded"
  | "RetryExhausted"
  // Decision lifecycle (emitted when the DecisionEngine is consulted).
  | "DecisionEvaluated"
  | "DecisionProceed"
  | "DecisionSkip"
  | "DecisionAbort"
  | "DecisionRetry"
  // Agent-specific (reserved for a future agent-aware layer).
  | "ResearchStarted"
  | "ResearchCompleted"
  | "ScriptStarted"
  | "ScriptCompleted"
  | "VoiceStarted"
  | "VoiceFailed"
  | "VoiceCompleted"
  | "Retry";

/** A single, timestamped log entry. */
export interface ExecutionEvent {
  readonly type: ExecutionEventType;
  /** When it happened (ISO 8601). */
  readonly at: string;
  /** The plan node/step it relates to, if any. */
  readonly stepId?: string;
  /** Optional human-readable note. */
  readonly message?: string;
  /** Optional extra structured detail (no secrets). */
  readonly data?: Readonly<Record<string, unknown>>;
}
