import type { ProviderName } from "../types.js";
import type { ProviderClient } from "./provider-client.js";
import { MockProviderClient } from "./mock-provider-client.js";
import { ClaudeProviderClient } from "./claude/index.js";

/**
 * createProviderClient — returns a ProviderClient for the requested provider.
 *
 * "claude" now returns the real ClaudeProviderClient; everything else falls back
 * to the MockProviderClient. Adding OpenAI/Gemini later = one more `case` here
 * plus a sibling adapter folder — nothing upstream changes.
 */
export function createProviderClient(provider: ProviderName = "mock"): ProviderClient {
  switch (provider) {
    case "claude":
      return new ClaudeProviderClient();
    default:
      return new MockProviderClient();
  }
}
