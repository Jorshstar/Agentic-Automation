import Anthropic from "@anthropic-ai/sdk";
import type { ProviderResponse, ProviderCitation, FinishReason } from "../provider-response.js";
import type { BaseError } from "../../../lib/errors.js";
import {
  ProviderUnavailableError,
  RateLimitError,
  AuthenticationError,
  InvalidRequestError,
  ProviderResponseError,
} from "../provider-error.js";

/**
 * Translates an Anthropic response (and Anthropic errors) into the standardized
 * ProviderResponse / typed ProviderErrors. All Anthropic-specific shapes are
 * consumed here and never surface above the Provider SDK Layer.
 */

/** Map an Anthropic Message onto the standardized ProviderResponse. */
export function toProviderResponse(
  message: Anthropic.Message,
  latencyMs: number,
): ProviderResponse {
  const content = finalText(message);

  const promptTokens = message.usage.input_tokens;
  const completionTokens = message.usage.output_tokens;

  return {
    content,
    provider: "claude",
    model: message.model,
    usage: {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    },
    finishReason: mapFinishReason(message.stop_reason),
    latencyMs,
    // CITED = the model grounded prose in it. RETRIEVED = the search fetched it,
    // including pages the model explored and discarded. Keep them separate: a
    // retrieved page is real, but it is not evidence the answer used it.
    citations: extractCitations(message),
    searchResults: dedupe(extractSearchResults(message)),
    webSearchCount: message.usage.server_tool_use?.web_search_requests ?? 0,
    raw: message,
  };
}

/**
 * The model's ANSWER, not its narration.
 *
 * When server tools run, the model interleaves commentary ("I'll search for
 * X...") with tool blocks, then writes the real answer last. Everything before
 * the final tool block is scaffolding, so we keep only the text after it. With
 * no tool blocks (the common case) this is just all the text.
 */
function finalText(message: Anthropic.Message): string {
  const isToolBlock = (block: Anthropic.ContentBlock): boolean =>
    block.type === "server_tool_use" || block.type === "web_search_tool_result";

  let lastToolIndex = -1;
  message.content.forEach((block, index) => {
    if (isToolBlock(block)) {
      lastToolIndex = index;
    }
  });

  return message.content
    .slice(lastToolIndex + 1)
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}

/**
 * Pull the real sources out of a web-search response. Anthropic attaches
 * `web_search_result_location` citations to the text blocks it grounded; we
 * collect them in order and dedupe by URL.
 */
function extractCitations(message: Anthropic.Message): readonly ProviderCitation[] {
  const byUrl = new Map<string, ProviderCitation>();
  for (const block of message.content) {
    if (block.type !== "text" || !block.citations) {
      continue;
    }
    for (const citation of block.citations) {
      if (citation.type === "web_search_result_location" && !byUrl.has(citation.url)) {
        byUrl.set(citation.url, { url: citation.url, title: citation.title ?? citation.url });
      }
    }
  }
  return [...byUrl.values()];
}

/**
 * The pages the web search actually retrieved. Used when the model's answer is
 * structured (JSON) and therefore carries no inline citations. `content` is an
 * error object rather than a list when the search failed — hence the Array check.
 */
function extractSearchResults(message: Anthropic.Message): readonly ProviderCitation[] {
  const found: ProviderCitation[] = [];
  for (const block of message.content) {
    if (block.type !== "web_search_tool_result" || !Array.isArray(block.content)) {
      continue;
    }
    for (const result of block.content) {
      if (result.type === "web_search_result") {
        found.push({ url: result.url, title: result.title || result.url });
      }
    }
  }
  return found;
}

function dedupe(citations: readonly ProviderCitation[]): readonly ProviderCitation[] {
  return [...new Map(citations.map((c) => [c.url, c])).values()];
}

function mapFinishReason(stopReason: Anthropic.Message["stop_reason"]): FinishReason {
  switch (stopReason) {
    case "end_turn":
    case "stop_sequence":
    case "tool_use":
    case "pause_turn":
      return "stop";
    case "max_tokens":
      return "length";
    case "refusal":
      return "content_filter";
    default:
      return "unknown";
  }
}

/** Map any thrown Anthropic SDK error onto one of our typed ProviderErrors. */
export function mapAnthropicError(error: unknown): BaseError {
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  ) {
    return new AuthenticationError(error.message);
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new RateLimitError(error.message);
  }
  if (
    error instanceof Anthropic.BadRequestError ||
    error instanceof Anthropic.NotFoundError ||
    error instanceof Anthropic.UnprocessableEntityError
  ) {
    return new InvalidRequestError(error.message);
  }
  if (error instanceof Anthropic.InternalServerError) {
    return new ProviderUnavailableError(error.message);
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new ProviderUnavailableError(error.message);
  }
  if (error instanceof Anthropic.APIError) {
    // e.g. 529 overloaded → retryable; other statuses → non-retryable response error.
    const status = error.status ?? 0;
    return status >= 500
      ? new ProviderUnavailableError(error.message)
      : new ProviderResponseError(error.message);
  }
  const message = error instanceof Error ? error.message : String(error);
  return new ProviderResponseError(message);
}
