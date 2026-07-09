import { logger } from "../lib/logger.js";
import type { ExecutionStrategy } from "./execution-strategy.js";
import type { ExecutionContext } from "./execution-context.js";
import type { ExecutionResult } from "./execution-result.js";
import type { ExecutionStatus } from "./node-state.js";
import type { PlanNode } from "./execution-plan.js";
import type { NodeExecutor } from "./node-executor.js";
import type { DecisionEngine } from "./decision-engine.js";
import { NotImplementedError } from "./decision-engine.js";

/**
 * SequentialExecutionStrategy — orchestrates execution ORDER, one node at a time,
 * and runs the DECISION LOOP.
 *
 * For each runnable node it: delegates execution to the NodeExecutor, then asks
 * the DecisionEngine "what next?" and acts on the verdict (proceed, skip, or
 * abort). It never resolves agents, touches PipelineData, or performs retries.
 */
export class SequentialExecutionStrategy implements ExecutionStrategy {
  readonly name = "sequential-execution-strategy";

  constructor(
    private readonly nodeExecutor: NodeExecutor,
    private readonly decisionEngine: DecisionEngine,
  ) {}

  async execute(context: ExecutionContext): Promise<ExecutionResult> {
    context.setVariable("strategy", this.name);
    logger.info("Using execution strategy", { strategy: this.name });

    const completedNodes: string[] = [];
    const failedNodes: string[] = [];
    let aborted = false;

    context.setExecutionStatus("running");
    context.appendEvent("ExecutionStarted", {
      message: `Executing ${context.plan.nodes.length} node(s) sequentially.`,
    });

    for (
      let node = this.findRunnableNode(context);
      node !== undefined;
      node = this.findRunnableNode(context)
    ) {
      // 1. Execute the node (NodeExecutor handles retries internally).
      context = await this.nodeExecutor.execute(node, context);

      // 2. Ask the DecisionEngine what should happen next, and record it.
      const decision = this.decisionEngine.evaluate(context);
      context.recordDecision(decision);

      // 3. Act on the decision.
      switch (decision.kind) {
        case "Proceed":
          completedNodes.push(node.id);
          break;
        case "Skip":
          context.setNodeState(node.id, "skipped");
          break;
        case "Abort":
          if (context.getNodeState(node.id) === "failed") {
            failedNodes.push(node.id);
          }
          aborted = true;
          break;
        case "Retry":
          // DecisionEngine defers retries to the NodeExecutor: re-queue the node.
          context.setNodeState(node.id, "pending");
          break;
        case "InsertNode":
        case "ReplaceNode":
        case "Branch":
          throw new NotImplementedError(`Decision "${decision.kind}" is not implemented yet.`);
        default: {
          const exhaustive: never = decision.kind;
          throw new NotImplementedError(`Unknown decision "${String(exhaustive)}".`);
        }
      }

      if (aborted) {
        break;
      }
    }

    const status = this.computeStatus(context, aborted);
    context.setExecutionStatus(status);
    if (status === "completed") {
      context.appendEvent("ExecutionCompleted", {
        message: `Completed ${completedNodes.length} node(s).`,
      });
    }

    return {
      status,
      completedNodes,
      failedNodes,
      context,
      pipelineData: context.getPipelineData(),
      decisionHistory: context.getDecisionHistory(),
    };
  }

  /** Whole run is "completed" only if every node is completed or skipped. */
  private computeStatus(context: ExecutionContext, aborted: boolean): ExecutionStatus {
    if (aborted) {
      return "failed";
    }
    const allResolved = context.plan.nodes.every((node) => {
      const state = context.getNodeState(node.id);
      return state === "completed" || state === "skipped";
    });
    return allResolved ? "completed" : "failed";
  }

  /**
   * A node is runnable when it is still "pending" and every node that must come
   * before it (its incoming edges) is "completed" or "skipped".
   */
  private findRunnableNode(context: ExecutionContext): PlanNode | undefined {
    return context.plan.nodes.find((node) => {
      if (context.getNodeState(node.id) !== "pending") {
        return false;
      }
      const dependencyIds = context.plan.edges
        .filter((edge) => edge.to === node.id)
        .map((edge) => edge.from);
      return dependencyIds.every((depId) => {
        const state = context.getNodeState(depId);
        return state === "completed" || state === "skipped";
      });
    });
  }
}
