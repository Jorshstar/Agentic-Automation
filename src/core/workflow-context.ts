import type { Niche } from "../types/index.js";
import type { Logger } from "../lib/logger.js";
import type { RuntimeConfig } from "../config/runtime.js";
import type { WorkflowState } from "./workflow-state.js";

/**
 * WorkflowContext — the shared "backpack" carried through one workflow run.
 *
 * Every future agent receives this so it always knows who it is working for,
 * where in the pipeline it is, how to log, and what the runtime settings are.
 * It is READ-ONLY: when the state changes you create a fresh context (see
 * {@link withWorkflowState}) rather than mutating in place. Immutable data is
 * easier to reason about and safe to pass around concurrently.
 *
 * NOTE: deliberately free of AI-specific fields — those arrive in a later step.
 */
export interface WorkflowContext {
  /** Ties together every log line of this run (great for tracing). */
  readonly correlationId: string;
  /** Unique id for this single execution attempt. */
  readonly executionId: string;
  /** Which pipeline stage the workflow is currently in. */
  readonly state: WorkflowState;
  /** The content niche this run is producing for. */
  readonly niche: Niche;
  /** Structured logger shared by every step. */
  readonly logger: Logger;
  /** Derived runtime settings (environment, timezone, output dir). */
  readonly runtime: RuntimeConfig;
  /** When this execution started (ISO 8601). */
  readonly startedAt: string;
}

/**
 * Return a NEW context with an updated state, leaving the original untouched.
 * Pure function — no side effects, easy to test.
 */
export function withWorkflowState(
  context: WorkflowContext,
  state: WorkflowState,
): WorkflowContext {
  return { ...context, state };
}
