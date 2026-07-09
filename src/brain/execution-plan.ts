import type { WorkflowState } from "../core/workflow-state.js";

/**
 * ExecutionPlan — the Brain's "recipe" for reaching a goal, as a GRAPH.
 *
 * Previously this was a flat list of steps. It is now a Directed Acyclic Graph
 * (DAG): a set of `nodes` (the agents to run) plus `edges` (which node must come
 * before which). A simple Research → Script → Voice pipeline is just three nodes
 * in a straight line, but the graph shape lets future plans express branches and
 * parallel work. NOTE: this step only changes the MODEL — nothing executes the
 * graph yet.
 */

/** One unit of work in the plan (an agent to run later). */
export interface PlanNode {
  /** Stable id, unique within the plan (e.g. "node-1-research-agent"). */
  readonly id: string;
  /** The agent the Brain will resolve from the registry for this node. */
  readonly agentName: string;
  /** The workflow state this node corresponds to, if any. */
  readonly state?: WorkflowState;
  /** If true, a failure of this node may be skipped instead of aborting the run. */
  readonly skippable?: boolean;
}

/** A "must run before" link: `from` must complete before `to` starts. */
export interface PlanEdge {
  /** Source node id. */
  readonly from: string;
  /** Target node id. */
  readonly to: string;
}

export interface ExecutionPlan {
  /** The goal this plan was built for. */
  readonly goalId: string;
  /** The agents to run, as graph nodes. */
  readonly nodes: readonly PlanNode[];
  /** The ordering dependencies between nodes. */
  readonly edges: readonly PlanEdge[];
  /** When the plan was created (ISO 8601). */
  readonly createdAt: string;
}
