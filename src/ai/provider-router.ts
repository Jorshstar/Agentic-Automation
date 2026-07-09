import type { ProviderName } from "./types.js";
import type { LLMProvider } from "./llm-provider.js";

/**
 * ProviderRouter — picks WHICH LLM provider to use for a request.
 *
 * Designed to support OpenAI, Claude, Gemini, Perplexity, DeepSeek, local models,
 * and mocks (see {@link ProviderName}). This is only the contract — no routing
 * logic or providers are implemented here.
 */
export interface ProviderRouter {
  /** Resolve a provider (by explicit name, or the router's default). */
  route(provider?: ProviderName): LLMProvider;
}
