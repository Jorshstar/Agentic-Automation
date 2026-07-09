import { ExecutionContext } from "../brain/execution-context.js";
import type { ExecutionStrategy } from "../brain/execution-strategy.js";
import type { ExecutionResult } from "../brain/execution-result.js";
import type { PolicyResult } from "../brain/policy-engine.js";
import type { BrainGoal } from "../brain/goal.js";
import type { ExecutionPlan } from "../brain/execution-plan.js";
import { createPipelineData } from "../pipeline/pipeline-builder.js";
import type { Topic } from "../pipeline/models/topic.js";
import type { RuntimeKernel } from "./runtime-kernel-interface.js";

/**
 * DefaultRuntimeKernel — the standard local runtime.
 *
 * It owns the ExecutionContext lifecycle (create + seed the initial Topic),
 * records the policy verdict, short-circuits when the plan is blocked, and
 * otherwise delegates the actual run to its ExecutionStrategy (which owns the
 * node executor, retries, and the decision loop). This is exactly the behaviour
 * the Brain used to perform inline — now it lives here.
 */
export class DefaultRuntimeKernel implements RuntimeKernel {
  constructor(private readonly strategy: ExecutionStrategy) {}

  async execute(
    goal: BrainGoal,
    plan: ExecutionPlan,
    policy: PolicyResult,
  ): Promise<ExecutionResult> {
    // ExecutionContext lifecycle: create it, seeded with a Topic from the goal
    // so the first agent (Research) has something to work from.
    const topic: Topic = {
      title: goal.topicTitle ?? goal.description,
      angle: goal.description,
      keywords: [],
    };
    const context = new ExecutionContext({
      goal,
      plan,
      pipelineData: createPipelineData({ topic }),
    });
    context.setVariable("policy", policy);

    // Runtime respects the Brain's policy verdict: blocked → do not execute.
    if (!policy.allowed) {
      context.setExecutionStatus("failed");
      return {
        status: "failed",
        completedNodes: [],
        failedNodes: [],
        context,
        pipelineData: context.getPipelineData(),
        decisionHistory: context.getDecisionHistory(),
      };
    }

    // Delegate ordering, decisions, retries, and execution to the strategy.
    return this.strategy.execute(context);
  }
}
