import type { ProviderName } from "../../types.js";
import type { ProviderClient } from "../provider-client.js";
import type { ProviderRequest } from "../provider-request.js";
import type { ProviderResponse } from "../provider-response.js";
import { AuthenticationError } from "../provider-error.js";
import { toOpenAIRequest, resolveModel } from "./openai-request-mapper.js";
import {
  toProviderResponse,
  mapOpenAIHttpError,
  mapOpenAITransportError,
} from "./openai-response-mapper.js";
import type { OpenAIChatResponse } from "./openai-response-mapper.js";

/**
 * OpenAIProviderClient — the second real ProviderClient.
 *
 * Added because the clipping pipeline is meant to run on OpenAI alone, while the
 * only implemented provider was Claude; a job would get all the way through
 * downloading and analysing a source and then fail at moment selection on an
 * Anthropic billing error.
 *
 * Uses native fetch rather than the OpenAI SDK: this is two endpoints' worth of
 * surface, and the rest of the clip pipeline (transcription, vision) already
 * calls OpenAI the same way, so a dependency would buy nothing.
 *
 * Nothing OpenAI-shaped escapes this folder — callers only see ProviderClient.
 */
/** Where an OpenAI-compatible client should point, and what to call it. */
export interface OpenAICompatibleOptions {
  readonly provider: ProviderName;
  readonly apiKey: string;
  readonly baseUrl: string;
  /** Used when the prompt names a model this endpoint does not serve. */
  readonly defaultModel?: string;
  /**
   * Minimum max_tokens to request.
   *
   * Reasoning models spend part of their completion budget THINKING before
   * writing anything, and that spend comes out of max_tokens. A request with a
   * tight budget comes back HTTP 200 with empty content — measured on
   * gpt-oss-120b, where a 30-token budget was consumed entirely by 27 reasoning
   * tokens. Raising the floor is what stops a stage silently producing nothing.
   */
  readonly minMaxTokens?: number;
}

export class OpenAIProviderClient implements ProviderClient {
  readonly provider: ProviderName;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string | undefined;
  private readonly minMaxTokens: number | undefined;

  constructor(options?: OpenAICompatibleOptions) {
    if (options) {
      if (options.apiKey.trim() === "") {
        throw new AuthenticationError(`No API key configured for provider "${options.provider}".`);
      }
      this.provider = options.provider;
      this.apiKey = options.apiKey;
      this.baseUrl = options.baseUrl.replace(/\/+$/u, "");
      this.defaultModel = options.defaultModel;
      this.minMaxTokens = options.minMaxTokens;
      return;
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || apiKey.trim() === "") {
      throw new AuthenticationError(
        "OPENAI_API_KEY is not set. Add it to .env (local) and the environment.",
      );
    }
    this.provider = "openai";
    this.apiKey = apiKey;
    // Supports an Azure/compatible gateway without touching any call site.
    this.baseUrl = (process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(
      /\/+$/u,
      "",
    );
    this.defaultModel = undefined;
    this.minMaxTokens = undefined;
  }

  async generate(request: ProviderRequest): Promise<ProviderResponse> {
    const startedAt = Date.now();
    const body = toOpenAIRequest(
      this.defaultModel ? { ...request, model: this.defaultModel } : request,
      this.minMaxTokens,
    );

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          // The key is read here and never logged, including on failure.
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw mapOpenAITransportError(error);
    }

    if (!response.ok) {
      throw mapOpenAIHttpError(response.status, await response.text().catch(() => ""));
    }

    let payload: OpenAIChatResponse;
    try {
      payload = (await response.json()) as OpenAIChatResponse;
    } catch (error) {
      throw mapOpenAITransportError(error);
    }

    return toProviderResponse(
      payload,
      this.defaultModel ?? resolveModel(request.model),
      Date.now() - startedAt,
    );
  }
}

/** Long enough for a large JSON completion, short enough to fail a hung socket. */
const REQUEST_TIMEOUT_MS = 180_000;
