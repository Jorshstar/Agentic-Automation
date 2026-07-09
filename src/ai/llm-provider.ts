import type { ProviderName } from "./types.js";

/**
 * LLMProvider — the CONTRACT any language-model backend must satisfy.
 *
 * The AI Kernel talks only to this interface, never to a specific vendor SDK. No
 * real provider is implemented in this step.
 */

export interface LLMCompletionRequest {
  readonly prompt: string;
  readonly model: string;
  readonly temperature: number;
}

export interface LLMCompletionResponse {
  /** The raw text the model returned. */
  readonly text: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface LLMProvider {
  readonly name: ProviderName;
  complete(request: LLMCompletionRequest): Promise<LLMCompletionResponse>;
}
