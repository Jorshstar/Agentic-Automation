import type { AgentRegistry } from "../core/agent-registry.js";
import type { AgentLifecycle } from "../core/lifecycle/agent-lifecycle.js";
import type { WorkflowContext } from "../core/workflow-context.js";
import { WorkflowState } from "../core/workflow-state.js";
import { runtimeConfig } from "../config/runtime.js";
import { logger } from "../lib/logger.js";
import { newCorrelationId } from "../lib/correlation.js";
import type { ExecutionContext } from "./execution-context.js";
import type { PlanNode } from "./execution-plan.js";
import type { RetryPolicy } from "./retry-policy.js";
import { FixedRetryPolicy } from "./retry-policy.js";

/**
 * NodeExecutor — knows HOW to execute ONE node.
 *
 * The strategy decides WHICH node runs next; this component does the actual work
 * for a single node, INCLUDING retries. To the strategy, a node with retries and
 * a node without look identical: it just gets back a completed or failed node.
 */
export interface NodeExecutor {
  /** Execute one node against the run's context, returning the updated context. */
  execute(node: PlanNode, context: ExecutionContext): Promise<ExecutionContext>;
}

/**
 * AgentNodeExecutor — the default executor. It resolves the node's agent from the
 * registry (never instantiates one), runs it, and RETRIES on failure according
 * to the injected RetryPolicy. It contains ALL runtime logic for a single node.
 */
export class AgentNodeExecutor implements NodeExecutor {
  constructor(
    private readonly registry: AgentRegistry<AgentLifecycle>,
    private readonly retryPolicy: RetryPolicy = new FixedRetryPolicy(),
  ) {}

  async execute(node: PlanNode, context: ExecutionContext): Promise<ExecutionContext> {
    // pending → running (first attempt)
    context.setCurrentNode(node.id);
    context.setNodeState(node.id, "running");
    context.setNodeAttempt(node.id, 1);
    context.appendEvent("NodeStarted", { stepId: node.id, data: { agentName: node.agentName } });

    if (!this.registry.has(node.agentName)) {
      context.setNodeState(node.id, "failed");
      context.appendEvent("NodeFailed", {
        stepId: node.id,
        message: `Agent not registered: "${node.agentName}".`,
        data: { agentName: node.agentName },
      });
      return context;
    }

    // Resolve (look up) the agent once — retries reuse the same instance.
    const agent = this.registry.resolve(node.agentName);

    let attempt = 1;
    for (;;) {
      context.setNodeAttempt(node.id, attempt);
      if (attempt > 1) {
        context.appendEvent("RetryStarted", {
          stepId: node.id,
          data: { agentName: node.agentName, attempt },
        });
      }

      const workflowContext = this.buildWorkflowContext(context, node);
      const result = await agent.run(workflowContext, context.getPipelineData());

      if (result.success) {
        // Immutable update: replace the pipeline with the agent's returned copy.
        context.setPipelineData(result.pipelineData);
        context.setNodeState(node.id, "completed");
        if (attempt > 1) {
          context.appendEvent("RetrySucceeded", {
            stepId: node.id,
            data: { agentName: node.agentName, attempt },
          });
        }
        context.appendEvent("NodeCompleted", { stepId: node.id, data: { agentName: node.agentName } });
        return context;
      }

      const failureMessage =
        result.errors.map((error) => error.message).join("; ") || "Agent failed.";

      // Should we try again?
      if (this.retryPolicy.shouldRetry(attempt)) {
        const delayMs = this.retryPolicy.nextDelay(attempt);
        context.appendEvent("RetryScheduled", {
          stepId: node.id,
          message: `Attempt ${attempt} failed; retrying in ${delayMs}ms.`,
          data: { agentName: node.agentName, attempt, delayMs },
        });
        await this.wait(delayMs);
        attempt += 1;
        continue;
      }

      // Retries exhausted → running → failed.
      context.setNodeState(node.id, "failed");
      context.appendEvent("RetryExhausted", {
        stepId: node.id,
        message: `All ${attempt} attempt(s) failed.`,
        data: { agentName: node.agentName, attempts: attempt },
      });
      context.appendEvent("NodeFailed", {
        stepId: node.id,
        message: failureMessage,
        data: { agentName: node.agentName },
      });
      return context;
    }
  }

  private wait(ms: number): Promise<void> {
    if (ms <= 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Build the per-node WorkflowContext the agent's lifecycle expects. */
  private buildWorkflowContext(context: ExecutionContext, node: PlanNode): WorkflowContext {
    return {
      correlationId: context.goal.id,
      executionId: newCorrelationId("exec"),
      state: node.state ?? WorkflowState.Pending,
      niche: context.goal.niche ?? "scary-stories",
      logger,
      runtime: runtimeConfig,
      startedAt: new Date().toISOString(),
    };
  }
}
