import type { AgentRegistry } from "../core/agent-registry.js";
import type { AgentLifecycle } from "../core/lifecycle/agent-lifecycle.js";
import type { BrainGoal } from "./goal.js";
import type { Planner } from "./planner.js";
import { SimplePlanner } from "./planner.js";
import type { PolicyEngine } from "./policy-engine.js";
import {
  DefaultPolicyEngine,
  MaxStepsPolicy,
  NonEmptyPlanPolicy,
  RegisteredAgentsPolicy,
} from "./policy-engine.js";
import type { PolicyConfig } from "./policy-config.js";
import { DEFAULT_POLICY_CONFIG } from "./policy-config.js";
import type { ExecutionResult } from "./execution-result.js";
import type { RuntimeKernel } from "../runtime/runtime-kernel-interface.js";

/** The collaborators the Brain reasons with (injected for testability). */
export interface BrainDependencies {
  readonly planner: Planner;
  readonly policyEngine: PolicyEngine;
  /** The runtime that actually executes the plan. */
  readonly runtimeKernel: RuntimeKernel;
}

/**
 * Brain — the part that THINKS. It contains no execution logic at all.
 *
 * Flow: goal → Planner → ExecutionPlan → validate Policy → hand goal + plan +
 * policy to the RuntimeKernel → return its ExecutionResult.
 *
 * The Brain never creates an ExecutionContext, resolves an agent, or runs a
 * strategy — that all belongs to the runtime.
 */
export class Brain {
  constructor(private readonly deps: BrainDependencies) {}

  async execute(goal: BrainGoal): Promise<ExecutionResult> {
    const { planner, policyEngine, runtimeKernel } = this.deps;

    // Think: make a plan and check the rules.
    const plan = planner.plan(goal);
    const policy = policyEngine.enforce({ goal, plan });

    // Execute: hand off to the runtime kernel.
    return runtimeKernel.execute(goal, plan, policy);
  }
}

/**
 * Convenience factory: build a Brain that reasons with the default planner and
 * policy engine, and executes via the provided RuntimeKernel (see
 * `createDefaultRuntime`). The Brain factory simply RECEIVES a kernel.
 */
export function createDefaultBrain(
  registry: AgentRegistry<AgentLifecycle>,
  runtimeKernel: RuntimeKernel,
  config: PolicyConfig = DEFAULT_POLICY_CONFIG,
): Brain {
  return new Brain({
    planner: new SimplePlanner(registry),
    policyEngine: new DefaultPolicyEngine(config, [
      new NonEmptyPlanPolicy(),
      new RegisteredAgentsPolicy(registry),
      new MaxStepsPolicy(),
    ]),
    runtimeKernel,
  });
}
