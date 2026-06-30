/**
 * Cost-tracking contracts.
 *
 * Interfaces only — they describe HOW cost data will be shaped once we start
 * spending money on AI/voice/video providers. There are no providers, no
 * prices, and no calculations here yet; just the agreed structure so future
 * billing/reporting code has something stable to target.
 */

/** Token usage for a single model call. */
export interface ModelUsage {
  /** Provider name as free text for now (e.g. "openai"); no provider code here. */
  readonly provider: string;
  /** Model identifier (e.g. "gpt-x", "claude-y"). */
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/** Money spent with one provider during an execution. */
export interface ProviderCost {
  readonly provider: string;
  /** Amount in US dollars. */
  readonly amountUsd: number;
}

/** The full cost picture for a single workflow execution. */
export interface ExecutionCost {
  readonly executionId: string;
  readonly usages: readonly ModelUsage[];
  readonly providerCosts: readonly ProviderCost[];
  /** Grand total in US dollars (computed by future code, not here). */
  readonly totalUsd: number;
}
