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
    default:
      return new MockProviderClient();
  }
}
