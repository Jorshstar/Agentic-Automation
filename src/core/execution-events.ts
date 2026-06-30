import type { ExecutionErrorInfo } from "./execution-result.js";

/**
 * Execution events — typed messages describing what the engine is doing.
 *
 * These are CONTRACTS only: there is no event bus, no publisher, no subscriber.
 * The engine can optionally call a simple listener with these objects so future
 * code (logging, metrics, dashboards) has a stable shape to react to.
 */

/** Fields shared by every event. */
interface BaseEvent {
  readonly correlationId: string;
  readonly executionId: string;
  /** When the event happened (ISO 8601). */
  readonly occurredAt: string;
}

export interface WorkflowStartedEvent extends BaseEvent {
  readonly type: "workflow.started";
  readonly workflowId: string;
}

export interface StepStartedEvent extends BaseEvent {
  readonly type: "step.started";
  readonly stepId: string;
  readonly stepName: string;
}

export interface StepCompletedEvent extends BaseEvent {
  readonly type: "step.completed";
  readonly stepId: string;
  readonly stepName: string;
}

export interface StepFailedEvent extends BaseEvent {
  readonly type: "step.failed";
  readonly stepId: string;
  readonly stepName: string;
  readonly error: ExecutionErrorInfo;
}

export interface WorkflowCompletedEvent extends BaseEvent {
  readonly type: "workflow.completed";
  readonly durationMs: number;
}

export interface WorkflowFailedEvent extends BaseEvent {
  readonly type: "workflow.failed";
  readonly durationMs: number;
  readonly error: ExecutionErrorInfo;
}

/** Discriminated union of all events; branch on `event.type`. */
export type WorkflowEvent =
  | WorkflowStartedEvent
  | StepStartedEvent
  | StepCompletedEvent
  | StepFailedEvent
  | WorkflowCompletedEvent
  | WorkflowFailedEvent;

/** A function the engine can call when an event occurs. (Not an event bus.) */
export type WorkflowEventListener = (event: WorkflowEvent) => void;
