import type { ProviderRequest } from "../provider-request.js";

/**
 * Maps the normalized {@link ProviderRequest} onto an OpenAI Chat Completions
 * body. OpenAI-shaped types never leave this folder.
 */

/** Used when the caller asks for a model this provider cannot serve. */
export const DEFAULT_OPENAI_MODEL = "gpt-4o";

export interface OpenAIMessage {
  readonly role: "system" | "user";
  readonly content: string;
}

export interface OpenAIChatRequest {
  readonly model: string;
  readonly messages: readonly OpenAIMessage[];
  readonly temperature?: number;
  readonly max_tokens?: number;
  readonly response_format?: { readonly type: "json_object" };
}

/**
 * Pick the model to actually send.
 *
 * The prompt registry stores a `preferredModel` per prompt, and for prompts
 * written against Claude that value is a Claude id. Forwarding it to OpenAI
 * would fail with an unhelpful 400, so a foreign id is replaced by this
 * provider's default (override with OPENAI_MODEL).
 */
export function resolveModel(requested: string): string {
  const fallback = process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
  if (requested.trim() === "" || requested === "mock-model") return fallback;
  // Anything that is clearly another vendor's id cannot be served here.
  if (/^(claude|anthropic|gemini|models\/|deepseek|sonar)/iu.test(requested)) return fallback;
  return requested;
}

/**
 * @param minMaxTokens Floor for max_tokens. Reasoning models spend part of the
 * completion budget thinking before they write, so a tight budget returns HTTP
 * 200 with EMPTY content — measured on gpt-oss-120b, where a 30-token request
 * was consumed entirely by 27 reasoning tokens. Raising the floor is what keeps
 * a stage from silently producing nothing.
 */
export function toOpenAIRequest(
  request: ProviderRequest,
  minMaxTokens?: number,
): OpenAIChatRequest {
  const messages: OpenAIMessage[] = [];
  if (request.systemPrompt !== undefined && request.systemPrompt.trim() !== "") {
    messages.push({ role: "system", content: request.systemPrompt });
  }
  messages.push({ role: "user", content: request.userPrompt });

  const wantsJson = request.expectedOutput === "json";

  return {
    model: resolveModel(request.model),
    // JSON mode is REFUSED unless the literal word "json" appears somewhere in
    // the messages. Our prompts say "valid JSON", which satisfies it — but a
    // prompt that does not would otherwise fail with a confusing 400, so the
    // check is explicit rather than assumed.
    messages: wantsJson && !mentionsJson(messages) ? withJsonNote(messages) : messages,
    temperature: request.temperature,
    ...(resolveMaxTokens(request.maxTokens, minMaxTokens) !== undefined
      ? { max_tokens: resolveMaxTokens(request.maxTokens, minMaxTokens) }
      : {}),
    ...(wantsJson ? { response_format: { type: "json_object" as const } } : {}),
  };
}

/** The larger of what the caller asked for and the endpoint's floor. */
export function resolveMaxTokens(
  requested: number | undefined,
  floor: number | undefined,
): number | undefined {
  if (floor === undefined) return requested;
  if (requested === undefined) return floor;
  return Math.max(requested, floor);
}

function mentionsJson(messages: readonly OpenAIMessage[]): boolean {
  return messages.some((message) => /json/iu.test(message.content));
}

function withJsonNote(messages: readonly OpenAIMessage[]): OpenAIMessage[] {
  const copy = [...messages];
  const last = copy.at(-1)!;
  copy[copy.length - 1] = { ...last, content: `${last.content}\n\nRespond with valid JSON.` };
  return copy;
}
