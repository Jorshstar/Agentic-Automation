/**
 * The Provider SDK Layer — the boundary between the AI Kernel and any real LLM
 * SDK/HTTP API. Callers build a normalized ProviderRequest, hand it to a
 * ProviderClient (via `createProviderClient`), and get a standardized
 * ProviderResponse back. No vendor SDKs are implemented here.
 */

// Contracts.
export type { ProviderClient } from "./provider-client.js";
export type { ProviderRequest } from "./provider-request.js";
export type {
  ProviderResponse,
  ProviderUsage,
  FinishReason,
} from "./provider-response.js";

// Typed errors (models only).
export {
  ProviderUnavailableError,
  RateLimitError,
  AuthenticationError,
  InvalidRequestError,
  TimeoutError,
  QuotaExceededError,
  ProviderResponseError,
} from "./provider-error.js";

// Mock client + factory.
export { MockProviderClient } from "./mock-provider-client.js";
export { createProviderClient } from "./provider-factory.js";
