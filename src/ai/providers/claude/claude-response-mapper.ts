import Anthropic from "@anthropic-ai/sdk";
import type { ProviderResponse, FinishReason } from "../provider-response.js";
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
  // Concatenate the text blocks (ignore non-text blocks like tool_use).
  const content = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

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
    raw: message,
  };
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
