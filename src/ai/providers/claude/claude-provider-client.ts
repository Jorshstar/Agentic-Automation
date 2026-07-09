import Anthropic from "@anthropic-ai/sdk";
import type { ProviderName } from "../../types.js";
import type { ProviderClient } from "../provider-client.js";
import type { ProviderRequest } from "../provider-request.js";
import type { ProviderResponse } from "../provider-response.js";
import { AuthenticationError } from "../provider-error.js";
import { toAnthropicRequest } from "./claude-request-mapper.js";
import { toProviderResponse, mapAnthropicError } from "./claude-response-mapper.js";

/**
 * ClaudeProviderClient — the FIRST real ProviderClient (Anthropic Claude).
 *
 * It accepts a normalized ProviderRequest, maps it to the Anthropic Messages API,
 * calls the official SDK, and maps the response back to a standardized
 * ProviderResponse (throwing typed ProviderErrors on failure). Anthropic types
 * never escape this folder — the outside world only sees ProviderClient.
 */
export class ClaudeProviderClient implements ProviderClient {
  readonly provider: ProviderName = "claude";
  private readonly client: Anthropic;

  constructor() {
    // Validate the API key here — never hardcode it.
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey || apiKey.trim() === "") {
      throw new AuthenticationError(
        "ANTHROPIC_API_KEY is not set. Add it to .env (local) and the environment.",
      );
    }
    this.client = new Anthropic({ apiKey });
  }

  async generate(request: ProviderRequest): Promise<ProviderResponse> {
    const startedAt = Date.now();
    try {
      const params = toAnthropicRequest(request);
      const message = await this.client.messages.create(params);
      return toProviderResponse(message, Date.now() - startedAt);
    } catch (error) {
      // Normalize any Anthropic SDK error into a typed ProviderError.
      throw mapAnthropicError(error);
    }
  }
}
