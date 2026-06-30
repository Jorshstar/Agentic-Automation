import type { WorkflowContext } from "../workflow-context.js";
import type { PipelineData } from "../../pipeline/pipeline-data.js";

/**
 * Agent hooks — OPTIONAL extension points an agent may fill in.
 *
 * Think of them as "before", "after", and "on-error" slots. An agent that needs
 * to do something extra (warm a cache, emit a metric, clean up on error) can
 * implement the matching hook; if it doesn't, nothing happens. There is no
 * default business behaviour — these are just empty slots waiting to be used.
 */
export interface AgentHooks {
  /** Runs just before the main work. */
  beforeExecute?(context: WorkflowContext, data: PipelineData): void | Promise<void>;
  /** Runs just after the main work succeeds. */
  afterExecute?(context: WorkflowContext, data: PipelineData): void | Promise<void>;
  /** Runs if the main work throws. */
  onError?(context: WorkflowContext, error: unknown): void | Promise<void>;
}
