import type { ProviderName } from "../types.js";
import type { ProviderClient } from "./provider-client.js";
import { MockProviderClient } from "./mock-provider-client.js";
import { ClaudeProviderClient } from "./claude/index.js";
import { OpenAIProviderClient } from "./openai/index.js";

/**
 * createProviderClient — returns a ProviderClient for the requested provider.
 *
 * "claude" and "openai" return real clients; everything else falls back to the
 * MockProviderClient. Adding Gemini later = one more `case` here plus a sibling
 * adapter folder — nothing upstream changes.
 */
export function createProviderClient(provider: ProviderName = "mock"): ProviderClient {
  switch (provider) {
    case "claude":
      return new ClaudeProviderClient();
    case "openai":
      return new OpenAIProviderClient();
    case "local":
      // Any OpenAI-compatible endpoint: a self-hosted server, a gateway, a
      // different vendor's compatible API. Same wire format, so the same client
      // serves it — only the address, key and model differ.
      return new OpenAIProviderClient({
        provider: "local",
        apiKey: process.env.LLM_API_KEY ?? "",
        baseUrl: process.env.LLM_BASE_URL ?? "",
        defaultModel: process.env.LLM_MODEL?.trim() || undefined,
        // Reasoning models spend completion budget thinking before they write.
        // Measured on gpt-oss-120b: a 30-token request returned HTTP 200 with
        // empty content because 27 tokens went to reasoning. This floor keeps
        // a small request from silently producing nothing.
        minMaxTokens: Number(process.env.LLM_MIN_MAX_TOKENS ?? 2000),
        // A self-hosted endpoint is far slower than a hosted one: measured at
        // 60-90s for a short prompt and 201s for a long one, which overran the
        // default and failed a call that would have succeeded. Background
        // stages can afford to wait; the interactive chat brain is the one that
        // cannot, so it stays on a hosted provider instead.
        timeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 420_000),
      });
    default:
      return new MockProviderClient();
  }
}
