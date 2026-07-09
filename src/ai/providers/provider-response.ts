import type { ProviderName } from "../types.js";

/**
 * ProviderResponse — the ONE standardized response shape.
 *
 * Whatever a real provider returns, its client normalizes it into this. The AI
 * Kernel (eventually) consumes only this — so it never depends on any vendor's
 * response format.
 */

/** Why the model stopped generating. */
export type FinishReason = "stop" | "length" | "content_filter" | "error" | "unknown";

export interface ProviderUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export interface ProviderResponse {
  /** The generated text. */
  readonly content: string;
  readonly provider: ProviderName;
  readonly model: string;
  readonly usage: ProviderUsage;
  readonly finishReason: FinishReason;
  /** Round-trip time in milliseconds. */
  readonly latencyMs: number;
  /** The raw provider payload, kept opaque (`unknown`, never `any`). */
  readonly raw: unknown;
}
