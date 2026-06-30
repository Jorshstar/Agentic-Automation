import type { WorkflowContext } from "../workflow-context.js";
import type { PipelineData } from "../../pipeline/pipeline-data.js";
import type { ExecutionErrorInfo } from "../execution-result.js";
import { toExecutionError } from "../execution-result.js";
import type { AgentHooks } from "./agent-hooks.js";
import type { AgentResult } from "./agent-result.js";
import type { AgentMetrics } from "./agent-metrics.js";
import { startTimer } from "./agent-timing.js";

/**
 * AgentLifecycle — the abstract base class every future agent extends.
 *
 * It implements the SAME execution flow for all agents (so no agent re-writes
 * timing, validation, error handling, or result building):
 *
 *   beforeExecute → validateInput → execute → validateOutput →
 *   afterExecute → onSuccess          (on success)
 *   ...or onFailure + onError         (on any thrown error)
 *   ...then cleanup                   (always)
 *
 * A subclass MUST implement `execute()` (the real work). Every other step is an
 * optional override that does nothing by default. This class contains ZERO
 * business logic — it only coordinates the order of calls.
 */
export abstract class AgentLifecycle implements AgentHooks {
  /** Stable identifier for logs/metrics (e.g. "script-agent"). */
  abstract readonly name: string;

  /** The real work: read the pipeline, return an updated COPY. */
  protected abstract execute(
    context: WorkflowContext,
    data: PipelineData,
  ): Promise<PipelineData>;

  // ----- Optional lifecycle steps (override as needed; default: no-op) -----

  /** Check the incoming pipeline has what this agent needs (throw to abort). */
  protected validateInput(_context: WorkflowContext, _data: PipelineData): void | Promise<void> {
    /* no-op by default */
  }

  /** Check the produced pipeline looks right (throw to abort). */
  protected validateOutput(_context: WorkflowContext, _data: PipelineData): void | Promise<void> {
    /* no-op by default */
  }

  /** Collect any non-fatal warnings to attach to the result. */
  protected collectWarnings(_context: WorkflowContext, _data: PipelineData): readonly string[] {
    return [];
  }

  /** Runs after a successful run. */
  protected onSuccess(_context: WorkflowContext, _data: PipelineData): void | Promise<void> {
    /* no-op by default */
  }

  /** Runs after a failed run. */
  protected onFailure(_context: WorkflowContext, _error: unknown): void | Promise<void> {
    /* no-op by default */
  }

  /** Always runs at the very end (success or failure). */
  protected cleanup(_context: WorkflowContext): void | Promise<void> {
    /* no-op by default */
  }

  // ----- Optional hooks from AgentHooks (default: no-op) -----

  beforeExecute(_context: WorkflowContext, _data: PipelineData): void | Promise<void> {
    /* no-op by default */
  }

  afterExecute(_context: WorkflowContext, _data: PipelineData): void | Promise<void> {
    /* no-op by default */
  }

  onError(_context: WorkflowContext, _error: unknown): void | Promise<void> {
    /* no-op by default */
  }

  // ----- The template method that ties it all together -----

  async run(context: WorkflowContext, data: PipelineData): Promise<AgentResult> {
    const timer = startTimer();
    const warnings: string[] = [];
    const errors: ExecutionErrorInfo[] = [];
    let output: PipelineData = data;
    let success = false;

    try {
      await this.beforeExecute(context, data);
      await this.validateInput(context, data);
      output = await this.execute(context, data);
      await this.validateOutput(context, output);
      await this.afterExecute(context, output);
      warnings.push(...this.collectWarnings(context, output));
      await this.onSuccess(context, output);
      success = true;
    } catch (error) {
      errors.push(toExecutionError(error));
      // On failure, keep the original pipeline untouched.
      output = data;
      await this.runFailureHandlers(context, error);
    } finally {
      await this.runCleanup(context);
    }

    const { durationMs } = timer.finish();
    const metrics: AgentMetrics = { durationMs, retryCount: 0 };

    return {
      success,
      durationMs,
      warnings,
      errors,
      metrics,
      pipelineData: output,
      correlationId: context.correlationId,
    };
  }

  /** Run onFailure + onError, never letting a hook error escape `run()`. */
  private async runFailureHandlers(context: WorkflowContext, error: unknown): Promise<void> {
    try {
      await this.onFailure(context, error);
    } catch {
      /* a failing failure-hook must not mask the original error */
    }
    try {
      await this.onError(context, error);
    } catch {
      /* same: swallow hook errors */
    }
  }

  /** Run cleanup, never letting a cleanup error escape `run()`. */
  private async runCleanup(context: WorkflowContext): Promise<void> {
    try {
      await this.cleanup(context);
    } catch {
      /* cleanup must never throw out of run() */
    }
  }
}
