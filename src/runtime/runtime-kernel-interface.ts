import type { BrainGoal } from "../brain/goal.js";
import type { ExecutionPlan } from "../brain/execution-plan.js";
import type { ExecutionResult } from "../brain/execution-result.js";
import type { PolicyResult } from "../brain/policy-engine.js";

/**
 * RuntimeKernel — the thing that EXECUTES.
 *
 * The Brain thinks (plans + validates policy) and then hands the goal, the plan,
 * and the policy verdict to a RuntimeKernel. The kernel owns everything about
 * *running* the plan: the execution context, the strategy, the node executor,
 * retries, the decision loop, and event recording. The Brain depends only on
 * this interface, so any runtime (local, distributed, cloud) can be plugged in.
 */
export interface RuntimeKernel {
  execute(goal: BrainGoal, plan: ExecutionPlan, policy: PolicyResult): Promise<ExecutionResult>;
}
