/**
 * Retry-policy contracts.
 *
 * These describe HOW retries should behave, as plain data. There is NO retry
 * logic here yet — nothing reads these values and loops. A future executor will
 * consume a `RetryPolicy` to decide whether/when to try again.
 */

/** Fixed delay every attempt, or growing delay (exponential backoff). */
export type BackoffStrategy = "fixed" | "exponential";

export interface BackoffPolicy {
  readonly strategy: BackoffStrategy;
  /** Delay before the first retry, in milliseconds. */
  readonly initialDelayMs: number;
  /** Upper bound on the delay, in milliseconds. */
  readonly maxDelayMs: number;
  /** Multiplier applied each attempt for "exponential" backoff (e.g. 2). */
  readonly factor: number;
}

export interface RetryPolicy {
  /** Total attempts allowed, including the first try. */
  readonly maxAttempts: number;
  readonly backoff: BackoffPolicy;
  /** Error codes (from our typed errors) that are safe to retry. */
  readonly retryableErrorCodes?: readonly string[];
}

/** A sensible default policy callers can start from. Pure data, no behaviour. */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  backoff: {
    strategy: "exponential",
    initialDelayMs: 1_000,
    maxDelayMs: 10_000,
    factor: 2,
  },
};
