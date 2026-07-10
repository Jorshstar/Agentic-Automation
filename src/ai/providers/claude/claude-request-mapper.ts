import type Anthropic from "@anthropic-ai/sdk";
import type { ProviderRequest } from "../provider-request.js";

/**
 * Translates a normalized ProviderRequest into Anthropic Messages API params.
 * This is where Anthropic-specific request shaping lives — nothing above the
 * Provider SDK Layer ever constructs an Anthropic request.
 */

/** Default model when the request doesn't specify one. */
const DEFAULT_MODEL = "claude-opus-4-8";
/** Default output cap. */
const DEFAULT_MAX_TOKENS = 1024;

/**
 * Current-generation models reject sampling params (`temperature`/`top_p`/`top_k`)
 * with a 400. For those, we omit `temperature` entirely. Older models accept it.
 */
const TEMPERATURE_UNSUPPORTED_MODELS = new Set<string>([
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-sonnet-5",
  "claude-fable-5",
  "claude-mythos-5",
]);

export function toAnthropicRequest(
  request: ProviderRequest,
): Anthropic.MessageCreateParamsNonStreaming {
  const model = request.model || DEFAULT_MODEL;

  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model,
    max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
    messages: [{ role: "user", content: request.userPrompt }],
  };

  if (request.systemPrompt) {
    params.system = request.systemPrompt;
  }

  // Server-side web search: Anthropic runs the searches and returns cited text.
  //
  // `allowed_callers: ["direct"]` is REQUIRED here. This tool version defaults to
  // running search inside code execution ("dynamic filtering"), which on this
  // account is rate-limited — the model burns its turn retrying and returns no
  // briefing. Direct invocation skips code execution entirely.
  if (request.webSearch) {
    const tool: Anthropic.Messages.WebSearchTool20260209 = {
      type: "web_search_20260209",
      name: "web_search",
      allowed_callers: ["direct"],
      ...(request.webSearch.maxUses !== undefined ? { max_uses: request.webSearch.maxUses } : {}),
      ...(request.webSearch.allowedDomains
        ? { allowed_domains: [...request.webSearch.allowedDomains] }
        : {}),
    };
    params.tools = [tool];
  }

  // Only send temperature to models that accept it (avoids a 400 on modern models).
  if (!TEMPERATURE_UNSUPPORTED_MODELS.has(model)) {
    params.temperature = request.temperature;
  }

  return params;
}
