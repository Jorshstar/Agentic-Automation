import { ConfigurationError } from "./errors.js";

/**
 * withRetry — exponential backoff with jitter for flaky external calls.
 *
 * Every network call in the pipeline (OpenAI TTS/Images, Telegram, Upstash) goes
 * through this so a transient 429/5xx/timeout never kills a run. Permanent
 * failures (bad API key → ConfigurationError, or anything `shouldRetry` rejects)
 * are re-thrown immediately — retrying a wrong key is pointless.
 *
 * (Claude calls don't need this wrapper: the Anthropic SDK retries transient
 * failures itself, and the run ledger's stage resume covers the rest.)
 */

export interface RetryOptions {
  /** Total attempts including the first (default 3). */
  readonly attempts?: number;
  /** First backoff delay in ms (default 1000; then ×2 each retry + jitter). */
  readonly baseDelayMs?: number;
  /** Cap on a single backoff delay (default 15s). */
  readonly maxDelayMs?: number;
  /** Return false to fail immediately (default: retry everything transient). */
  readonly shouldRetry?: (error: unknown) => boolean;
  /** Called before each retry (for logs). */
  readonly onRetry?: (attempt: number, error: unknown) => void;
}

/** Default policy: never retry configuration/auth problems. */
function defaultShouldRetry(error: unknown): boolean {
  return !(error instanceof ConfigurationError);
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const maxDelayMs = options.maxDelayMs ?? 15_000;
  const shouldRetry = options.shouldRetry ?? defaultShouldRetry;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const isLast = attempt === attempts;
      if (isLast || !shouldRetry(error)) {
        throw error;
      }
      options.onRetry?.(attempt, error);
      const exponential = baseDelayMs * Math.pow(2, attempt - 1);
      const jitter = Math.random() * baseDelayMs;
      await sleep(Math.min(exponential + jitter, maxDelayMs));
    }
  }
  throw lastError; // unreachable, but keeps TS + future edits honest
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
