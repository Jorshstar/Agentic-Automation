/**
 * PolicyConfig — the tunable knobs the policy engine reads instead of
 * hardcoded constants. For now these are set in code; a future step could load
 * them from a file/database, but this step deliberately does NOT do that.
 */
export interface PolicyConfig {
  /** Maximum retry attempts allowed for a step. */
  readonly maxRetries: number;
  /** Maximum number of nodes a plan may contain. */
  readonly maxSteps: number;
  /** Whether a human must approve before execution (used later). */
  readonly approvalRequired: boolean;
  /** Spend cap for one run, in US dollars (used later). */
  readonly budgetUsd: number;
  /** Whether the decision engine is allowed to skip a failed, skippable node. */
  readonly allowSkips: boolean;
}

/** Sensible defaults, instantiated in code. */
export const DEFAULT_POLICY_CONFIG: PolicyConfig = {
  maxRetries: 3,
  maxSteps: 25,
  approvalRequired: false,
  budgetUsd: 5,
  allowSkips: true,
};
