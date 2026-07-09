import type { AgentRegistry } from "../core/agent-registry.js";
import type { AgentLifecycle } from "../core/lifecycle/agent-lifecycle.js";
import { SequentialExecutionStrategy } from "../brain/sequential-execution-strategy.js";
import { AgentNodeExecutor } from "../brain/node-executor.js";
import { FixedRetryPolicy } from "../brain/retry-policy.js";
import { DefaultDecisionEngine } from "../brain/decision-engine.js";
import type { PolicyConfig } from "../brain/policy-config.js";
import { DEFAULT_POLICY_CONFIG } from "../brain/policy-config.js";
import type { RuntimeKernel } from "./runtime-kernel-interface.js";
import { DefaultRuntimeKernel } from "./runtime-kernel.js";

/**
 * createDefaultRuntime — wires the standard local runtime:
 *   SequentialExecutionStrategy → AgentNodeExecutor → FixedRetryPolicy
 *   + DefaultDecisionEngine, all inside a DefaultRuntimeKernel.
 *
 * Swap any piece here (e.g. a ParallelExecutionStrategy) to change how execution
 * happens, without touching the Brain.
 */
export function createDefaultRuntime(
  registry: AgentRegistry<AgentLifecycle>,
  config: PolicyConfig = DEFAULT_POLICY_CONFIG,
): RuntimeKernel {
  const decisionEngine = new DefaultDecisionEngine(config);
  const strategy = new SequentialExecutionStrategy(
    new AgentNodeExecutor(registry, new FixedRetryPolicy(config.maxRetries)),
    decisionEngine,
  );
  return new DefaultRuntimeKernel(strategy);
}
