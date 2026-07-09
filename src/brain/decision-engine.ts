import type { PipelineData } from "../pipeline/pipeline-data.js";
import { BaseError } from "../lib/errors.js";
import type { PolicyConfig } from "./policy-config.js";
import { DEFAULT_POLICY_CONFIG } from "./policy-config.js";
import type { ExecutionContext } from "./execution-context.js";
import type { ExecutionDecision } from "./execution-decision.js";

/** Thrown when the strategy is asked to act on a not-yet-built decision kind. */
export class NotImplementedError extends BaseError {
  readonly code = "NOT_IMPLEMENTED";
  readonly retryable = false;
}

/**
 * DecisionEngine — the ACTIVE reasoning component.
 *
 * After each node is handled, the strategy calls `evaluate(context)`. The engine
 * looks at the current node's outcome (and the pipeline) and returns a decision:
 * Proceed / Skip / Abort (Retry is reserved; retries are done inside the
 * NodeExecutor). It only DECIDES — it never executes or retries anything itself.
 */
export interface DecisionEngine {
  evaluate(context: ExecutionContext): ExecutionDecision;
}

/** A pluggable check: is the pipeline valid enough to continue? */
export type PipelineValidatorFn = (data: PipelineData) => boolean;

/**
 * DefaultDecisionEngine — simple, entirely rule-based (no AI):
 *   - node completed + pipeline valid → Proceed
 *   - node completed + pipeline INVALID → Abort
 *   - node failed (retries exhausted) + skippable + policy allows → Skip
 *   - node failed (retries exhausted) otherwise → Abort
 */
export class DefaultDecisionEngine implements DecisionEngine {
  constructor(
    private readonly config: PolicyConfig = DEFAULT_POLICY_CONFIG,
    private readonly validatePipeline: PipelineValidatorFn = () => true,
  ) {}

  evaluate(context: ExecutionContext): ExecutionDecision {
    const nodeId = context.getCurrentNode();
    const node = nodeId ? context.plan.nodes.find((candidate) => candidate.id === nodeId) : undefined;
    const state = nodeId ? context.getNodeState(nodeId) : undefined;
    const on = nodeId ? { nodeId } : {};

    if (state === "completed") {
      if (!this.validatePipeline(context.getPipelineData())) {
        return { kind: "Abort", reason: "PipelineData validation failed.", ...on };
      }
      return { kind: "Proceed", reason: "Node completed successfully.", ...on };
    }

    if (state === "failed") {
      if (node?.skippable && this.config.allowSkips) {
        return {
          kind: "Skip",
          reason: "Node failed but is skippable and policy allows skipping.",
          ...on,
        };
      }
      return { kind: "Abort", reason: "Node failed and retries are exhausted.", ...on };
    }

    // No blocking condition (e.g. node not yet run) → keep going.
    return { kind: "Proceed", reason: "No blocking condition detected.", ...on };
  }
}
