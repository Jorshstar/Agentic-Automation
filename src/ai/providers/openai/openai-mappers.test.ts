import { describe, it, expect, afterEach } from "vitest";
import { toOpenAIRequest, resolveModel, DEFAULT_OPENAI_MODEL } from "./openai-request-mapper.js";
import { toProviderResponse, mapOpenAIHttpError, mapOpenAITransportError } from "./openai-response-mapper.js";
import type { ProviderRequest } from "../provider-request.js";

const request = (over: Partial<ProviderRequest> = {}): ProviderRequest => ({
  userPrompt: "pick the clips",
  temperature: 0.4,
  model: "gpt-4o",
  provider: "openai",
  ...over,
});

afterEach(() => {
  delete process.env.OPENAI_MODEL;
});

describe("resolveModel", () => {
  it("passes an OpenAI model through", () => {
    expect(resolveModel("gpt-4o-mini")).toBe("gpt-4o-mini");
  });

  it("replaces another vendor's model id, which the registry supplies", () => {
    // The clip prompts list a Claude model as their preferred one; forwarding
    // that to OpenAI would 400.
    expect(resolveModel("claude-opus-4-8")).toBe(DEFAULT_OPENAI_MODEL);
    expect(resolveModel("gemini-2.0-pro")).toBe(DEFAULT_OPENAI_MODEL);
  });

  it("replaces the kernel's placeholder model", () => {
    expect(resolveModel("mock-model")).toBe(DEFAULT_OPENAI_MODEL);
    expect(resolveModel("")).toBe(DEFAULT_OPENAI_MODEL);
  });

  it("honours OPENAI_MODEL", () => {
    process.env.OPENAI_MODEL = "gpt-4o-mini";
    expect(resolveModel("claude-opus-4-8")).toBe("gpt-4o-mini");
  });
});

describe("toOpenAIRequest", () => {
  it("puts the system prompt first and the user prompt last", () => {
    const body = toOpenAIRequest(request({ systemPrompt: "you are an editor" }));
    expect(body.messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(body.messages[1]!.content).toBe("pick the clips");
  });

  it("omits an empty system prompt entirely", () => {
    expect(toOpenAIRequest(request({ systemPrompt: "   " })).messages).toHaveLength(1);
  });

  it("asks for JSON mode only when JSON is expected", () => {
    expect(toOpenAIRequest(request({ expectedOutput: "json" })).response_format).toEqual({
      type: "json_object",
    });
    expect(toOpenAIRequest(request({ expectedOutput: "text" })).response_format).toBeUndefined();
  });

  it("adds the word JSON when the prompt lacks it, since the API requires it", () => {
    const body = toOpenAIRequest(request({ expectedOutput: "json", userPrompt: "give me clips" }));
    expect(body.messages.at(-1)!.content).toMatch(/json/iu);
  });

  it("does not pad a prompt that already mentions JSON", () => {
    const body = toOpenAIRequest(
      request({ expectedOutput: "json", userPrompt: "Return ONLY valid JSON." }),
    );
    expect(body.messages.at(-1)!.content).toBe("Return ONLY valid JSON.");
  });

  it("passes temperature and maxTokens through", () => {
    const body = toOpenAIRequest(request({ temperature: 0.2, maxTokens: 1500 }));
    expect(body.temperature).toBe(0.2);
    expect(body.max_tokens).toBe(1500);
  });
});

describe("toProviderResponse", () => {
  it("normalises a successful completion", () => {
    const result = toProviderResponse(
      {
        model: "gpt-4o-2024-11-20",
        choices: [{ message: { content: '{"clips":[]}' }, finish_reason: "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      },
      "gpt-4o",
      42,
    );
    expect(result.content).toBe('{"clips":[]}');
    expect(result.provider).toBe("openai");
    expect(result.model).toBe("gpt-4o-2024-11-20");
    expect(result.usage.totalTokens).toBe(120);
    expect(result.finishReason).toBe("stop");
    expect(result.latencyMs).toBe(42);
  });

  it("derives a missing total from the parts", () => {
    const result = toProviderResponse(
      {
        choices: [{ message: { content: "hi" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 7, completion_tokens: 3 },
      },
      "gpt-4o",
      1,
    );
    expect(result.usage.totalTokens).toBe(10);
  });

  it("flags a truncated completion rather than passing it off as complete", () => {
    const result = toProviderResponse(
      { choices: [{ message: { content: "{" }, finish_reason: "length" }] },
      "gpt-4o",
      1,
    );
    expect(result.finishReason).toBe("length");
  });

  it("throws on an empty completion instead of returning empty content", () => {
    expect(() =>
      toProviderResponse({ choices: [{ message: { content: "" } }] }, "gpt-4o", 1),
    ).toThrowError(/empty completion/iu);
    expect(() => toProviderResponse({ choices: [] }, "gpt-4o", 1)).toThrowError();
  });
});

describe("mapOpenAIHttpError", () => {
  it("marks a bad key as non-retryable", () => {
    const error = mapOpenAIHttpError(401, '{"error":{"message":"Invalid API key"}}');
    expect(error.code).toBe("PROVIDER_AUTHENTICATION");
    expect(error.retryable).toBe(false);
  });

  it("separates a real rate limit from an exhausted balance", () => {
    // Both arrive as 429, but retrying a spent account is pointless.
    const limited = mapOpenAIHttpError(429, '{"error":{"message":"Rate limit reached"}}');
    expect(limited.code).toBe("PROVIDER_RATE_LIMIT");
    expect(limited.retryable).toBe(true);

    const broke = mapOpenAIHttpError(
      429,
      '{"error":{"message":"You exceeded your current quota","type":"insufficient_quota"}}',
    );
    expect(broke.code).toBe("PROVIDER_QUOTA_EXCEEDED");
    expect(broke.retryable).toBe(false);
  });

  it("treats a server fault as retryable and a bad request as not", () => {
    expect(mapOpenAIHttpError(503, "upstream down").retryable).toBe(true);
    expect(mapOpenAIHttpError(400, '{"error":{"message":"bad model"}}').retryable).toBe(false);
  });

  it("surfaces the provider's own message", () => {
    expect(mapOpenAIHttpError(400, '{"error":{"message":"unknown model xyz"}}').message).toContain(
      "unknown model xyz",
    );
  });

  it("survives a non-JSON body", () => {
    expect(mapOpenAIHttpError(502, "<html>Bad Gateway</html>").message).toContain("Bad Gateway");
  });
});

describe("mapOpenAITransportError", () => {
  it("maps an abort to a retryable timeout", () => {
    const error = mapOpenAITransportError(new Error("The operation was aborted due to timeout"));
    expect(error.code).toBe("PROVIDER_TIMEOUT");
    expect(error.retryable).toBe(true);
  });

  it("maps a socket failure to provider-unavailable", () => {
    expect(mapOpenAITransportError(new Error("ECONNRESET")).code).toBe("PROVIDER_UNAVAILABLE");
  });
});
