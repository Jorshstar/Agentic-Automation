/**
 * Typed error system.
 *
 * Plain `throw new Error("oops")` loses information. These classes attach:
 *   - a stable `code` (e.g. "RATE_LIMIT_ERROR") you can branch on safely,
 *   - a `retryable` flag so the orchestration layer knows whether to retry,
 *   - optional `context` + `toJSON()` for clean STRUCTURED logging later.
 *
 * SECURITY: never put secret values (keys, tokens) into `context`.
 */

/** Free-form, non-secret details attached to an error for logging/debugging. */
export type ErrorContext = Record<string, unknown>;

/** The serialised, log-friendly form of any {@link BaseError}. */
export interface SerializedError {
  readonly name: string;
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly timestamp: string;
  readonly context?: ErrorContext;
}

/**
 * Shared base for every custom error. It is `abstract`, so you never throw a
 * `BaseError` directly — you throw one of the specific subclasses below.
 */
export abstract class BaseError extends Error {
  /** Stable, machine-readable identifier (e.g. "VALIDATION_ERROR"). */
  abstract readonly code: string;
  /** Whether retrying the operation could reasonably succeed. */
  abstract readonly retryable: boolean;
  /** When the error was created (ISO 8601). */
  readonly timestamp: string;
  /** Optional non-secret details for logs. */
  readonly context?: ErrorContext;

  constructor(message: string, context?: ErrorContext) {
    super(message);
    // `new.target` is the actual subclass being constructed.
    this.name = new.target.name;
    this.timestamp = new Date().toISOString();
    if (context) {
      this.context = context;
    }
    // Restore the prototype chain (needed when extending built-in Error in TS).
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** Structured, log-safe representation. */
  toJSON(): SerializedError {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      timestamp: this.timestamp,
      ...(this.context ? { context: this.context } : {}),
    };
  }
}

/** Input/data failed validation. Not retryable — the same bad input will fail again. */
export class ValidationError extends BaseError {
  readonly code = "VALIDATION_ERROR";
  readonly retryable = false;
}

/** Missing/invalid configuration or environment. Not retryable until fixed. */
export class ConfigurationError extends BaseError {
  readonly code = "CONFIGURATION_ERROR";
  readonly retryable = false;
}

/** An AI provider call failed (transient by default, so retryable). */
export class AIProviderError extends BaseError {
  readonly code = "AI_PROVIDER_ERROR";
  readonly retryable = true;
}

/** A provider rate limit was hit. Retryable, optionally after `retryAfterSeconds`. */
export class RateLimitError extends BaseError {
  readonly code = "RATE_LIMIT_ERROR";
  readonly retryable = true;
  /** Seconds to wait before retrying, if the provider told us. */
  readonly retryAfterSeconds?: number;

  constructor(
    message: string,
    options?: { readonly retryAfterSeconds?: number; readonly context?: ErrorContext },
  ) {
    super(message, options?.context);
    if (options?.retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = options.retryAfterSeconds;
    }
  }
}

/** Reading from / writing to a storage backend failed (usually transient). */
export class StorageError extends BaseError {
  readonly code = "STORAGE_ERROR";
  readonly retryable = true;
}

/** Generic transient failure that is safe to retry. */
export class RetryableError extends BaseError {
  readonly code = "RETRYABLE_ERROR";
  readonly retryable = true;
}

/** Generic permanent failure that must NOT be retried. */
export class NonRetryableError extends BaseError {
  readonly code = "NON_RETRYABLE_ERROR";
  readonly retryable = false;
}

/** Type guard: is this one of our custom errors? */
export function isBaseError(error: unknown): error is BaseError {
  return error instanceof BaseError;
}

/** Decide whether ANY thrown value should be retried (unknown errors → no). */
export function isRetryable(error: unknown): boolean {
  return isBaseError(error) && error.retryable;
}
