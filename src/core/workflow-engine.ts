import type { WorkflowContext } from "./workflow-context.js";
import { withWorkflowState } from "./workflow-context.js";
import type { WorkflowDefinition } from "./workflow-definition.js";
import type { ExecutionResult } from "./execution-result.js";
import { toExecutionError } from "./execution-result.js";
import type { WorkflowEvent, WorkflowEventListener } from "./execution-events.js";
import { WorkflowState } from "./workflow-state.js";
import { assertTransition, canTransition } from "./state-machine.js";

/**
 * WorkflowEngine — the conductor.
 *
 * It takes a context and a workflow definition (an ordered list of steps) and:
 *   1. runs each step in order,
 *   2. feeds each step's output into the next step's input,
 *   3. advances the workflow state THROUGH THE STATE MACHINE (never directly),
 *   4. stops at the first failure,
 *   5. returns a typed {@link ExecutionResult}.
 *
 * It knows nothing about AI, providers, storage, video, or Telegram — only
 * workflows, steps, state, and execution. That tiny scope is the whole point.
 */
export interface WorkflowEngineOptions {
  /** Optional callback invoked with typed events as the run progresses. */
  readonly onEvent?: WorkflowEventListener;
}

export class WorkflowEngine {
  constructor(private readonly options: WorkflowEngineOptions = {}) {}

  async run(
    context: WorkflowContext,
    definition: WorkflowDefinition,
    initialInput?: unknown,
  ): Promise<ExecutionResult> {
    const startedMs = Date.now();
    const completedSteps: string[] = [];

    let currentContext = context;
    let currentState = context.state;
    let currentInput: unknown = initialInput;

    this.emit(currentContext, {
      type: "workflow.started",
      correlationId: currentContext.correlationId,
      executionId: currentContext.executionId,
      occurredAt: new Date().toISOString(),
      workflowId: definition.id,
    });

    for (const step of definition.steps) {
      // 1. If the step represents a state, validate + apply the transition.
      if (step.state && step.state !== currentState) {
        try {
          assertTransition(currentState, step.state);
        } catch (error) {
          return this.fail(currentContext, startedMs, completedSteps, error);
        }
        currentState = step.state;
        currentContext = withWorkflowState(currentContext, currentState);
      }

      this.emit(currentContext, {
        type: "step.started",
        correlationId: currentContext.correlationId,
        executionId: currentContext.executionId,
        occurredAt: new Date().toISOString(),
        stepId: step.id,
        stepName: step.name,
      });

      // 2. Run the step, passing the previous output as this step's input.
      try {
        currentInput = await step.execute(currentContext, currentInput);
      } catch (error) {
        this.emit(currentContext, {
          type: "step.failed",
          correlationId: currentContext.correlationId,
          executionId: currentContext.executionId,
          occurredAt: new Date().toISOString(),
          stepId: step.id,
          stepName: step.name,
          error: toExecutionError(error),
        });
        return this.fail(currentContext, startedMs, completedSteps, error);
      }

      completedSteps.push(step.id);
      this.emit(currentContext, {
        type: "step.completed",
        correlationId: currentContext.correlationId,
        executionId: currentContext.executionId,
        occurredAt: new Date().toISOString(),
        stepId: step.id,
        stepName: step.name,
      });
    }

    // 3. Move to Completed if the state machine allows it from where we ended.
    if (currentState !== WorkflowState.Completed && canTransition(currentState, WorkflowState.Completed)) {
      currentState = WorkflowState.Completed;
      currentContext = withWorkflowState(currentContext, currentState);
    }

    const durationMs = Date.now() - startedMs;
    this.emit(currentContext, {
      type: "workflow.completed",
      correlationId: currentContext.correlationId,
      executionId: currentContext.executionId,
      occurredAt: new Date().toISOString(),
      durationMs,
    });

    return {
      status: "success",
      state: currentState,
      correlationId: currentContext.correlationId,
      executionId: currentContext.executionId,
      durationMs,
      completedSteps,
    };
  }

  /** Build a failed result, moving to the Failed state and emitting the event. */
  private fail(
    context: WorkflowContext,
    startedMs: number,
    completedSteps: readonly string[],
    error: unknown,
  ): ExecutionResult {
    const failedState = canTransition(context.state, WorkflowState.Failed)
      ? WorkflowState.Failed
      : context.state;
    const durationMs = Date.now() - startedMs;
    const info = toExecutionError(error);

    this.emit(context, {
      type: "workflow.failed",
      correlationId: context.correlationId,
      executionId: context.executionId,
      occurredAt: new Date().toISOString(),
      durationMs,
      error: info,
    });

    return {
      status: "failed",
      state: failedState,
      correlationId: context.correlationId,
      executionId: context.executionId,
      durationMs,
      completedSteps: [...completedSteps],
      error: info,
    };
  }

  private emit(context: WorkflowContext, event: WorkflowEvent): void {
    context.logger.debug(`workflow event: ${event.type}`, { type: event.type });
    this.options.onEvent?.(event);
  }
}
