import Anthropic from "@anthropic-ai/sdk";
import type { ProviderName } from "../../types.js";
import type { ProviderClient } from "../provider-client.js";
import type { ProviderRequest } from "../provider-request.js";
import type { ProviderResponse, ProviderCitation } from "../provider-response.js";
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
      let message = await this.client.messages.create(params);

      // A long-running server tool (web search) can pause the turn. Resume by
      // sending the assistant's content back UNCHANGED, bounded so a pathological
      // loop can never run forever. Text/citations/search count accumulate.
      const messages = [...params.messages];
      let text = toProviderResponse(message, 0).content;
      let citations = toProviderResponse(message, 0).citations;
      let searchCount = searchesOf(message);

      for (let i = 0; i < MAX_PAUSE_CONTINUATIONS && message.stop_reason === "pause_turn"; i += 1) {
        messages.push({ role: "assistant", content: message.content });
        message = await this.client.messages.create({ ...params, messages });
        const partial = toProviderResponse(message, 0);
        text += partial.content;
        searchCount += searchesOf(message);
        citations = dedupeByUrl([...citations, ...partial.citations]);
      }

      const final = toProviderResponse(message, Date.now() - startedAt);
      return { ...final, content: text, citations, webSearchCount: searchCount };
    } catch (error) {
      // Normalize any Anthropic SDK error into a typed ProviderError.
      throw mapAnthropicError(error);
    }
  }
}

/** Cap on `pause_turn` resumes within one generate() call. */
const MAX_PAUSE_CONTINUATIONS = 3;

function searchesOf(message: Anthropic.Message): number {
  return message.usage.server_tool_use?.web_search_requests ?? 0;
}

function dedupeByUrl(citations: readonly ProviderCitation[]): readonly ProviderCitation[] {
  return [...new Map(citations.map((c) => [c.url, c])).values()];
}
