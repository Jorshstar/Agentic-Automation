import type { ProviderName, OutputFormat } from "../types.js";

/**
 * ProviderRequest — one NORMALIZED, provider-agnostic request.
 *
 * Every provider client receives this exact shape, no matter which vendor sits
 * behind it. Vendor-specific quirks (message roles, param names) are the client's
 * problem to translate — callers never see them.
 */
export interface ProviderRequest {
  /** Optional system instruction. */
  readonly systemPrompt?: string;
  /** The user prompt (required). */
  readonly userPrompt: string;
  readonly temperature: number;
  readonly maxTokens?: number;
  /** The shape of output the caller expects. */
  readonly expectedOutput?: OutputFormat;
  readonly model: string;
  readonly provider: ProviderName;
  /**
   * When set, the client enables its vendor's server-side web search so the
   * model can read live pages and return real citations.
   */
  readonly webSearch?: {
    readonly maxUses?: number;
    readonly allowedDomains?: readonly string[];
  };
  /** Free-form, non-secret metadata (e.g. correlation id). */
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** Reserved for future provider options; kept generic (never `any`). */
  readonly options?: Readonly<Record<string, unknown>>;
}
