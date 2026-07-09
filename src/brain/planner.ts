import type { AgentRegistry } from "../core/agent-registry.js";
import { WorkflowState } from "../core/workflow-state.js";
import type { BrainGoal } from "./goal.js";
import type { ExecutionPlan, PlanNode, PlanEdge } from "./execution-plan.js";

/**
 * Planner — the abstraction that turns a goal into an ExecutionPlan.
 *
 * The Brain depends ONLY on this interface, so the planning strategy can be
 * swapped later (e.g. an AI planner) without touching the Brain. Today there is
 * one implementation: `SimplePlanner`.
 */
export interface Planner {
  plan(goal: BrainGoal): ExecutionPlan;
}

interface PipelineEntry {
  readonly agentName: string;
  readonly state?: WorkflowState;
}

/**
 * The canonical end-to-end pipeline, in order. The simple planner keeps only the
 * entries whose agents are registered, so a partly-built system still plans.
 */
export const DEFAULT_PIPELINE: readonly PipelineEntry[] = [
  { agentName: "research-agent", state: WorkflowState.Researching },
  { agentName: "script-agent", state: WorkflowState.ScriptWriting },
  { agentName: "voice-agent", state: WorkflowState.VoiceGeneration },
  { agentName: "visual-asset-agent", state: WorkflowState.VisualGeneration },
  { agentName: "video-assembly-agent", state: WorkflowState.VideoAssembly },
  { agentName: "seo-agent" },
  { agentName: "quality-review-agent", state: WorkflowState.QualityReview },
  { agentName: "storage-agent", state: WorkflowState.Storage },
  { agentName: "notification-agent", state: WorkflowState.Notification },
];

/**
 * SimplePlanner — the current, non-AI planner. It produces the same
 * Research → Script → Voice workflow as before, but represented as a DAG (nodes
 * in a straight line joined by edges). It runs nothing.
 */
export class SimplePlanner implements Planner {
  constructor(private readonly registry: AgentRegistry) {}

  plan(goal: BrainGoal): ExecutionPlan {
    // Use explicitly requested agents, or the default pipeline filtered to what
    // is actually registered.
    const entries: readonly PipelineEntry[] = goal.requestedAgents
      ? goal.requestedAgents.map((agentName) => ({ agentName }))
      : DEFAULT_PIPELINE.filter((entry) => this.registry.has(entry.agentName));

    const nodes: PlanNode[] = entries.map((entry, index) => {
      const skippable = goal.skippableAgents?.includes(entry.agentName) ?? false;
      return {
        id: `node-${index + 1}-${entry.agentName}`,
        agentName: entry.agentName,
        ...(entry.state ? { state: entry.state } : {}),
        ...(skippable ? { skippable: true } : {}),
      };
    });

    // Straight-line dependencies: each node depends on the previous one.
    const edges: PlanEdge[] = [];
    let previous: PlanNode | undefined;
    for (const node of nodes) {
      if (previous) {
        edges.push({ from: previous.id, to: node.id });
      }
      previous = node;
    }

    return {
      goalId: goal.id,
      nodes,
      edges,
      createdAt: new Date().toISOString(),
    };
  }
}
