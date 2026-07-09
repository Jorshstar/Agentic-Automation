import { BaseError } from "../../lib/errors.js";

/**
 * Typed provider errors — MODELS ONLY (no retry logic; the runtime's retry engine
 * decides what to do). Each carries a stable code and a `retryable` hint. They
 * extend the project's shared BaseError, so they log cleanly via `toJSON()`.
 *
 * (Note: distinct from the generic RateLimitError in `lib/errors.ts` — this one
 * is provider-scoped.)
 */

/** The provider is temporarily down/unreachable. */
export class ProviderUnavailableError extends BaseError {
  readonly code = "PROVIDER_UNAVAILABLE";
  readonly retryable = true;
}

/** The provider rate-limited the request. */
export class RateLimitError extends BaseError {
  readonly code = "PROVIDER_RATE_LIMIT";
  readonly retryable = true;
}

/** Bad or missing credentials. */
export class AuthenticationError extends BaseError {
  readonly code = "PROVIDER_AUTHENTICATION";
  readonly retryable = false;
}

/** The request was malformed or unsupported. */
export class InvalidRequestError extends BaseError {
  readonly code = "PROVIDER_INVALID_REQUEST";
  readonly retryable = false;
}

/** The provider took too long to respond. */
export class TimeoutError extends BaseError {
  readonly code = "PROVIDER_TIMEOUT";
  readonly retryable = true;
}

/** The account's quota/budget is exhausted. */
export class QuotaExceededError extends BaseError {
  readonly code = "PROVIDER_QUOTA_EXCEEDED";
  readonly retryable = false;
}

/** The provider returned an unusable/garbled response. */
export class ProviderResponseError extends BaseError {
  readonly code = "PROVIDER_RESPONSE";
  readonly retryable = false;
}
