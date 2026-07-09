/**
 * RetryPolicy — the RULES for retrying a failed node.
 *
 * It answers two questions the NodeExecutor asks after a failed attempt:
 *   - shouldRetry(attempt): try again?
 *   - nextDelay(attempt):   how long to wait first?
 * ...and exposes `maxAttempts` for reference. The policy is injected into the
 * NodeExecutor, so retry behaviour is swappable without touching execution code.
 */
export interface RetryPolicy {
  /** Total attempts allowed, including the first try. */
  readonly maxAttempts: number;
  /** Given the attempt number that just failed (1-based), retry again? */
  shouldRetry(attempt: number): boolean;
  /** Milliseconds to wait before the next attempt. */
  nextDelay(attempt: number): number;
}

/**
 * FixedRetryPolicy — the simple default: up to `maxAttempts` tries, waiting a
 * constant `delayMs` between each. No exponential backoff, no jitter (yet).
 */
export class FixedRetryPolicy implements RetryPolicy {
  constructor(
    readonly maxAttempts: number = 3,
    private readonly delayMs: number = 1000,
  ) {}

  shouldRetry(attempt: number): boolean {
    return attempt < this.maxAttempts;
  }

  nextDelay(_attempt: number): number {
    return this.delayMs;
  }
}
