import type { AgentRegistry } from "../core/agent-registry.js";
import type { BrainGoal } from "./goal.js";
import type { ExecutionPlan } from "./execution-plan.js";
import type { PolicyConfig } from "./policy-config.js";

/**
 * PolicyEngine — enforces runtime RULES before the Brain proceeds.
 *
 * Think of it as a checklist of guardrails. Each rule is a small `Policy`; the
 * engine runs them all and reports whether the plan is allowed. The engine now
 * carries a `PolicyConfig` (max steps, retries, budget...) and hands it to every
 * rule, so limits are configurable instead of hardcoded.
 */

/** What the caller gives the engine. */
export interface PolicyEvaluationInput {
  readonly goal: BrainGoal;
  readonly plan: ExecutionPlan;
}

/** What each rule receives: the input plus the active config. */
export interface PolicyContext extends PolicyEvaluationInput {
  readonly config: PolicyConfig;
}

export interface PolicyViolation {
  /** Which rule was broken. */
  readonly rule: string;
  readonly message: string;
}

export interface PolicyResult {
  readonly allowed: boolean;
  readonly violations: readonly PolicyViolation[];
}

/** One guardrail. Returns the violations it found (empty = all good). */
export interface Policy {
  readonly name: string;
  evaluate(context: PolicyContext): readonly PolicyViolation[];
}

export interface PolicyEngine {
  enforce(input: PolicyEvaluationInput): PolicyResult;
}

export class DefaultPolicyEngine implements PolicyEngine {
  constructor(
    private readonly config: PolicyConfig,
    private readonly policies: readonly Policy[] = [],
  ) {}

  enforce(input: PolicyEvaluationInput): PolicyResult {
    const context: PolicyContext = { ...input, config: this.config };
    const violations = this.policies.flatMap((policy) => policy.evaluate(context));
    return { allowed: violations.length === 0, violations };
  }
}

/** A plan must have at least one node. */
export class NonEmptyPlanPolicy implements Policy {
  readonly name = "non-empty-plan";
  evaluate(context: PolicyContext): readonly PolicyViolation[] {
    if (context.plan.nodes.length === 0) {
      return [{ rule: this.name, message: "Execution plan has no nodes." }];
    }
    return [];
  }
}

/** Every agent referenced by the plan must be registered in the registry. */
export class RegisteredAgentsPolicy implements Policy {
  readonly name = "registered-agents";
  constructor(private readonly registry: AgentRegistry) {}
  evaluate(context: PolicyContext): readonly PolicyViolation[] {
    return context.plan.nodes
      .filter((node) => !this.registry.has(node.agentName))
      .map((node) => ({
        rule: this.name,
        message: `Agent not registered: "${node.agentName}".`,
      }));
  }
}

/** A plan may not exceed `config.maxSteps` nodes. */
export class MaxStepsPolicy implements Policy {
  readonly name = "max-steps";
  evaluate(context: PolicyContext): readonly PolicyViolation[] {
    const max = context.config.maxSteps;
    if (context.plan.nodes.length > max) {
      return [
        {
          rule: this.name,
          message: `Plan has ${context.plan.nodes.length} nodes; maximum allowed is ${max}.`,
        },
      ];
    }
    return [];
  }
}
