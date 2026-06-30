import type { PipelineData } from "../../pipeline/pipeline-data.js";
import type { ExecutionErrorInfo } from "../execution-result.js";
import type { AgentMetrics } from "./agent-metrics.js";

/**
 * AgentResult — the standard "report card" every agent run produces.
 *
 * Because every agent returns this exact shape, the orchestrator can treat all
 * agents identically: check `success`, read the updated `pipelineData`, record
 * `metrics`, and surface any `warnings`/`errors`.
 */
export interface AgentResult {
  /** Did the agent finish without throwing? */
  readonly success: boolean;
  /** How long the run took, in milliseconds. */
  readonly durationMs: number;
  /** Non-fatal notes worth surfacing. */
  readonly warnings: readonly string[];
  /** Fatal problems (present when `success` is false). */
  readonly errors: readonly ExecutionErrorInfo[];
  /** Run measurements (duration, retries, placeholders). */
  readonly metrics: AgentMetrics;
  /** The pipeline after this agent — updated on success, unchanged on failure. */
  readonly pipelineData: PipelineData;
  /** Ties this result back to the overall run. */
  readonly correlationId: string;
}
