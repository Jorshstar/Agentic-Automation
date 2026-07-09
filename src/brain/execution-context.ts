import type { BrainGoal } from "./goal.js";
import type { ExecutionPlan } from "./execution-plan.js";
import type { ExecutionEvent, ExecutionEventType } from "./execution-event.js";
import type { ExecutionDecision } from "./execution-decision.js";
import type { NodeState, ExecutionStatus } from "./node-state.js";
import type { RuntimeMemory } from "./runtime-memory.js";
import { InMemoryRuntimeMemory } from "./runtime-memory.js";
import type { PipelineData } from "../pipeline/pipeline-data.js";
import { createEmptyPipelineData } from "../pipeline/pipeline-builder.js";

/**
 * ExecutionContext — the full state of ONE run, in one place.
 *
 * It holds: the goal, the plan, the current PipelineData (replaced immutably),
 * shared variables (backed by RuntimeMemory), the current node, per-node states,
 * the overall execution status, and an APPEND-ONLY event log.
 *
 * No persistence, no replay, no analytics — just the in-memory structure the
 * execution engine reads from and writes to.
 */
export interface ExecutionContextInit {
  readonly goal: BrainGoal;
  readonly plan: ExecutionPlan;
  readonly pipelineData?: PipelineData;
}

export class ExecutionContext {
  readonly goal: BrainGoal;
  readonly plan: ExecutionPlan;

  private pipelineData: PipelineData;
  private currentNodeId: string | undefined;
  private status: ExecutionStatus = "pending";
  private readonly nodeStates = new Map<string, NodeState>();
  private readonly nodeAttempts = new Map<string, number>();
  private readonly variables: RuntimeMemory;
  private readonly events: ExecutionEvent[] = [];
  private readonly decisions: ExecutionDecision[] = [];

  constructor(init: ExecutionContextInit) {
    this.goal = init.goal;
    this.plan = init.plan;
    this.pipelineData = init.pipelineData ?? createEmptyPipelineData();
    this.variables = new InMemoryRuntimeMemory();
    // Every node starts in "pending".
    for (const node of init.plan.nodes) {
      this.nodeStates.set(node.id, "pending");
    }
  }

  // ----- Shared variables -----
  setVariable<T>(key: string, value: T): void {
    this.variables.set(key, value);
  }
  getVariable<T>(key: string): T | undefined {
    return this.variables.get<T>(key);
  }

  // ----- PipelineData (immutable replacement, never in-place mutation) -----
  getPipelineData(): PipelineData {
    return this.pipelineData;
  }
  setPipelineData(data: PipelineData): void {
    this.pipelineData = data;
  }

  // ----- Current node -----
  getCurrentNode(): string | undefined {
    return this.currentNodeId;
  }
  setCurrentNode(nodeId: string): void {
    this.currentNodeId = nodeId;
  }

  // ----- Per-node states -----
  getNodeState(nodeId: string): NodeState | undefined {
    return this.nodeStates.get(nodeId);
  }
  setNodeState(nodeId: string, state: NodeState): void {
    this.nodeStates.set(nodeId, state);
  }
  getNodeStates(): Readonly<Record<string, NodeState>> {
    return Object.fromEntries(this.nodeStates);
  }

  // ----- Per-node attempt counter (used by the retry engine) -----
  getNodeAttempt(nodeId: string): number {
    return this.nodeAttempts.get(nodeId) ?? 0;
  }
  setNodeAttempt(nodeId: string, attempt: number): void {
    this.nodeAttempts.set(nodeId, attempt);
  }

  // ----- Overall execution status -----
  getExecutionStatus(): ExecutionStatus {
    return this.status;
  }
  setExecutionStatus(status: ExecutionStatus): void {
    this.status = status;
  }

  // ----- Append-only event log -----
  /** Append a fully-formed event. */
  recordEvent(event: ExecutionEvent): void {
    this.events.push(event);
  }
  /** Convenience: append an event, timestamping it for you. */
  appendEvent(
    type: ExecutionEventType,
    details?: {
      readonly stepId?: string;
      readonly message?: string;
      readonly data?: Readonly<Record<string, unknown>>;
    },
  ): ExecutionEvent {
    const event: ExecutionEvent = {
      type,
      at: new Date().toISOString(),
      ...(details?.stepId ? { stepId: details.stepId } : {}),
      ...(details?.message ? { message: details.message } : {}),
      ...(details?.data ? { data: details.data } : {}),
    };
    this.events.push(event);
    return event;
  }
  /** A read-only copy of the log (the internal array is never exposed). */
  getEvents(): readonly ExecutionEvent[] {
    return [...this.events];
  }

  // ----- Append-only decision history -----
  /** Record a decision and emit its events (DecisionEvaluated + the specific one). */
  recordDecision(decision: ExecutionDecision): void {
    this.decisions.push(decision);
    const stepId = decision.nodeId ? { stepId: decision.nodeId } : {};
    this.appendEvent("DecisionEvaluated", { ...stepId, message: decision.reason, data: { kind: decision.kind } });
    const specific: Partial<Record<ExecutionDecision["kind"], ExecutionEventType>> = {
      Proceed: "DecisionProceed",
      Skip: "DecisionSkip",
      Abort: "DecisionAbort",
      Retry: "DecisionRetry",
    };
    const eventType = specific[decision.kind];
    if (eventType) {
      this.appendEvent(eventType, { ...stepId, message: decision.reason });
    }
  }
  /** A read-only copy of every decision made, in order. */
  getDecisionHistory(): readonly ExecutionDecision[] {
    return [...this.decisions];
  }

  /** Clean, log-friendly snapshot (used by JSON.stringify). */
  toJSON(): Readonly<Record<string, unknown>> {
    return {
      goalId: this.goal.id,
      status: this.status,
      planNodes: this.plan.nodes.length,
      planEdges: this.plan.edges.length,
      currentNode: this.currentNodeId ?? null,
      nodeStates: this.getNodeStates(),
      variables: this.variables.snapshot(),
      decisions: this.decisions,
      events: this.events,
    };
  }
}
