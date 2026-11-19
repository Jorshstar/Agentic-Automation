import type { ProviderResponse, FinishReason } from "../provider-response.js";
import {
  AuthenticationError,
  InvalidRequestError,
  ProviderResponseError,
  ProviderUnavailableError,
  QuotaExceededError,
  RateLimitError,
  TimeoutError,
} from "../provider-error.js";
import { BaseError } from "../../../lib/errors.js";

/** The slice of the OpenAI Chat Completions payload we rely on. */
export interface OpenAIChatResponse {
  readonly model?: string;
  readonly choices?: readonly {
    readonly message?: { readonly content?: string | null };
    readonly finish_reason?: string;
  }[];
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
    readonly total_tokens?: number;
  };
}

export function toProviderResponse(
  payload: OpenAIChatResponse,
  model: string,
  latencyMs: number,
): ProviderResponse {
  const choice = payload.choices?.[0];
  const content = choice?.message?.content ?? "";
  if (content.trim() === "") {
    throw new ProviderResponseError("OpenAI returned an empty completion.");
  }

  const promptTokens = payload.usage?.prompt_tokens ?? 0;
  const completionTokens = payload.usage?.completion_tokens ?? 0;

  return {
    content,
    provider: "openai",
    model: payload.model ?? model,
    usage: {
      promptTokens,
      completionTokens,
      totalTokens: payload.usage?.total_tokens ?? promptTokens + completionTokens,
    },
    finishReason: toFinishReason(choice?.finish_reason),
    latencyMs,
    // Chat Completions has no server-side web search, so these are always empty.
    // A caller that needs live sources should route to a provider that does.
    citations: [],
    searchResults: [],
    webSearchCount: 0,
    raw: payload,
  };
}

function toFinishReason(reason: string | undefined): FinishReason {
  switch (reason) {
    case "stop":
    case "tool_calls":
    case "function_call":
      return "stop";
    case "length":
      return "length";
    case "content_filter":
      return "content_filter";
    default:
      return "unknown";
  }
}

/**
 * Normalize an HTTP failure into a typed ProviderError.
 *
 * The distinction that matters most in practice is 429: a genuine rate limit is
 * worth retrying, but an exhausted balance is not, and OpenAI reports both with
 * the same status. The error `type`/`code` in the body is what separates them —
 * retrying a spent account just burns time.
 */
export function mapOpenAIHttpError(status: number, body: string): BaseError {
  const detail = extractMessage(body);
  if (status === 401 || status === 403) {
    return new AuthenticationError(`OpenAI rejected the API key: ${detail}`);
  }
  if (status === 429) {
    return /quota|billing|insufficient/iu.test(body)
      ? new QuotaExceededError(`OpenAI quota exhausted: ${detail}`)
      : new RateLimitError(`OpenAI rate limit: ${detail}`);
  }
  if (status === 408 || status === 504) {
    return new TimeoutError(`OpenAI timed out: ${detail}`);
  }
  if (status >= 500) {
    return new ProviderUnavailableError(`OpenAI is unavailable (${status}): ${detail}`);
  }
  return new InvalidRequestError(`OpenAI rejected the request (${status}): ${detail}`);
}

/** Turn a transport-level failure (abort, DNS, socket) into a typed error. */
export function mapOpenAITransportError(error: unknown): BaseError {
  if (error instanceof BaseError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/abort|timeout/iu.test(message)) {
    return new TimeoutError(`OpenAI request timed out: ${message}`);
  }
  return new ProviderUnavailableError(`OpenAI request failed: ${message}`);
}

/** Pull `error.message` out of the body, falling back to a truncated body. */
function extractMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    if (typeof parsed.error?.message === "string") return parsed.error.message;
  } catch {
    // not JSON — fall through
  }
  return body.slice(0, 300);
}
