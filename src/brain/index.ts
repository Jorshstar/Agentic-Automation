/**
 * The Brain layer — orchestrates all agents.
 *
 * Public surface: build a Brain (e.g. with `createDefaultBrain(registry)`) and
 * call `brain.execute(goal)`. Everything else here is the supporting parts the
 * Brain owns: planner, decision engine, policy engine, execution context.
 *
 * Architecture only: no agents are executed, no AI, no HTTP.
 */

// The Brain + its public types.
export { Brain, createDefaultBrain } from "./brain.js";
export type { BrainDependencies } from "./brain.js";

// Execution strategy (orchestrates order) + node executor (executes one node).
export { SequentialExecutionStrategy } from "./sequential-execution-strategy.js";
export type { ExecutionStrategy } from "./execution-strategy.js";
export { AgentNodeExecutor } from "./node-executor.js";
export type { NodeExecutor } from "./node-executor.js";
export { FixedRetryPolicy } from "./retry-policy.js";
export type { RetryPolicy } from "./retry-policy.js";
export type { ExecutionResult } from "./execution-result.js";
export type { NodeState, ExecutionStatus } from "./node-state.js";

// Goal + graph-based plan.
export type { BrainGoal } from "./goal.js";
export type { ExecutionPlan, PlanNode, PlanEdge } from "./execution-plan.js";

// Pluggable planner.
export { SimplePlanner, DEFAULT_PIPELINE } from "./planner.js";
export type { Planner } from "./planner.js";

// Decision engine (active reasoning loop) + decision type.
export { DefaultDecisionEngine, NotImplementedError } from "./decision-engine.js";
export type { DecisionEngine, PipelineValidatorFn } from "./decision-engine.js";
export type { ExecutionDecision, ExecutionDecisionKind } from "./execution-decision.js";

// Policy engine + configurable policy.
export {
  DefaultPolicyEngine,
  NonEmptyPlanPolicy,
  RegisteredAgentsPolicy,
  MaxStepsPolicy,
} from "./policy-engine.js";
export type {
  PolicyEngine,
  Policy,
  PolicyContext,
  PolicyEvaluationInput,
  PolicyResult,
  PolicyViolation,
} from "./policy-engine.js";
export { DEFAULT_POLICY_CONFIG } from "./policy-config.js";
export type { PolicyConfig } from "./policy-config.js";

// Execution context + event log (upgraded runtime memory).
export { ExecutionContext } from "./execution-context.js";
export type { ExecutionContextInit } from "./execution-context.js";
export type { ExecutionEvent, ExecutionEventType } from "./execution-event.js";

// Runtime memory (still used, now backing the ExecutionContext's variables).
export { InMemoryRuntimeMemory } from "./runtime-memory.js";
export type { RuntimeMemory } from "./runtime-memory.js";
