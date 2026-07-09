import type { ProviderName } from "../types.js";
import type { ProviderClient } from "./provider-client.js";
import type { ProviderRequest } from "./provider-request.js";
import type { ProviderResponse } from "./provider-response.js";

/**
 * MockProviderClient — a fake provider that returns a standardized
 * {@link ProviderResponse}. No AI, no network, no API key. It exists so the whole
 * stack can run against the new response model before any real SDK is wired in.
 */
export class MockProviderClient implements ProviderClient {
  readonly provider: ProviderName = "mock";

  async generate(request: ProviderRequest): Promise<ProviderResponse> {
    const startedAt = Date.now();

    const promptChars = (request.systemPrompt ?? "").length + request.userPrompt.length;
    const promptTokens = Math.ceil(promptChars / 4);
    const completionTokens = 24;

    const content = `[[mock ${request.model} response — ${request.userPrompt.slice(0, 48)}]]`;

    return {
      content,
      provider: this.provider,
      model: request.model,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
      finishReason: "stop",
      latencyMs: Date.now() - startedAt,
      raw: { mock: true, requestedProvider: request.provider, model: request.model },
    };
  }
}
