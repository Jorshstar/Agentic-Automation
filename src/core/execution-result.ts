import type { WorkflowState } from "./workflow-state.js";
import { isBaseError } from "../lib/errors.js";

/**
 * Execution result — the typed "report card" the engine returns after a run.
 */

/** How a run ended. */
export type ExecutionStatus = "success" | "failed" | "skipped" | "cancelled";

/** A compact, log-safe description of whatever went wrong. */
export interface ExecutionErrorInfo {
  readonly name: string;
  readonly message: string;
  /** Stable code, present when the error is one of our typed errors. */
  readonly code?: string;
  /** Whether the failed operation could be retried. */
  readonly retryable?: boolean;
}

/** Everything the caller needs to know about one workflow execution. */
export interface ExecutionResult {
  readonly status: ExecutionStatus;
  /** The workflow state the run ended in. */
  readonly state: WorkflowState;
  readonly correlationId: string;
  readonly executionId: string;
  /** How long the run took, in milliseconds. */
  readonly durationMs: number;
  /** Ids of the steps that completed successfully, in order. */
  readonly completedSteps: readonly string[];
  /** Present only when the run failed. */
  readonly error?: ExecutionErrorInfo;
}

/** Normalise ANY thrown value into a safe {@link ExecutionErrorInfo}. */
export function toExecutionError(error: unknown): ExecutionErrorInfo {
  if (isBaseError(error)) {
    return {
      name: error.name,
      message: error.message,
      code: error.code,
      retryable: error.retryable,
    };
  }
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { name: "UnknownError", message: String(error) };
}
