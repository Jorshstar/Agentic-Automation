/**
 * The core layer — reusable contracts and execution concepts that everything
 * else builds on. Import shared types from here, e.g.:
 *   import { WorkflowState, type WorkflowContext, type BaseAgent } from "../core/index.js";
 *
 * This layer is framework-agnostic and free of business logic / providers.
 */

// Workflow state (value + type) and helpers.
export {
  WorkflowState,
  TERMINAL_WORKFLOW_STATES,
  isTerminalWorkflowState,
} from "./workflow-state.js";

// Shared execution context.
export { withWorkflowState } from "./workflow-context.js";
export type { WorkflowContext } from "./workflow-context.js";

// Base agent contract.
export type { BaseAgent, AnyAgent } from "./base-agent.js";

// Persistence record shapes + repository abstractions.
export type {
  WorkflowRecord,
  ExecutionRecord,
  AssetRecord,
  AssetKind,
} from "./records.js";
export type {
  WorkflowRepository,
  ExecutionRepository,
  AssetRepository,
} from "./repositories.js";

// Cost-tracking contracts.
export type { ModelUsage, ProviderCost, ExecutionCost } from "./cost.js";

// Orchestration: steps, definitions, results, events, retry, engine.
export type { WorkflowStep, AnyWorkflowStep } from "./workflow-step.js";
export type { WorkflowDefinition } from "./workflow-definition.js";
export { toExecutionError } from "./execution-result.js";
export type {
  ExecutionStatus,
  ExecutionResult,
  ExecutionErrorInfo,
} from "./execution-result.js";
export type {
  WorkflowEvent,
  WorkflowEventListener,
  WorkflowStartedEvent,
  StepStartedEvent,
  StepCompletedEvent,
  StepFailedEvent,
  WorkflowCompletedEvent,
  WorkflowFailedEvent,
} from "./execution-events.js";
export { DEFAULT_RETRY_POLICY } from "./retry-policy.js";
export type { RetryPolicy, BackoffPolicy, BackoffStrategy } from "./retry-policy.js";

// State machine.
export {
  WORKFLOW_SEQUENCE,
  InvalidStateTransitionError,
  nextState,
  canTransition,
  assertTransition,
} from "./state-machine.js";

// Agent registry.
export { InMemoryAgentRegistry } from "./agent-registry.js";
export type { AgentRegistry, NamedAgent } from "./agent-registry.js";

// The engine.
export { WorkflowEngine } from "./workflow-engine.js";
export type { WorkflowEngineOptions } from "./workflow-engine.js";

// Agent lifecycle framework.
export { AgentLifecycle, startTimer } from "./lifecycle/index.js";
export type {
  AgentHooks,
  AgentResult,
  AgentMetrics,
  Timer,
  TimingResult,
} from "./lifecycle/index.js";

// Future agent contracts.
export type * from "./agents/index.js";
