import { describe, it, expect } from "vitest";
import type { AIKernel, AIGenerateRequest, AIGenerateResult, Citation } from "../../ai/index.js";
import { ClaudeResearchProvider } from "./claude-research-provider.js";

/** A stub kernel returning fixed text + citations, capturing the request. */
function stubKernel(output: string, citations: readonly Citation[] = []): {
  kernel: AIKernel;
  seen: { request?: AIGenerateRequest };
} {
  const seen: { request?: AIGenerateRequest } = {};
  const kernel: AIKernel = {
    async generate<TOutput = unknown>(request: AIGenerateRequest): Promise<AIGenerateResult<TOutput>> {
      seen.request = request;
      return {
        output: output as unknown as TOutput,
        promptId: request.promptId,
        promptVersion: "v2",
        provider: "claude",
        model: "stub",
        usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20, costUsd: 0 },
        latencyMs: 1,
        citations,
        webSearchCount: citations.length > 0 ? 2 : 0,
      };
    },
  };
  return { kernel, seen };
}

const BRIEFING =
  "Real summary sentence one. Real summary sentence two.\n\n" +
  "- Point one\n- Point two\n- Point three\n- Point four\n- Point five\n";

describe("ClaudeResearchProvider", () => {
  it("uses the user prompt with the system prompt, and asks for web search", async () => {
    const { kernel, seen } = stubKernel(BRIEFING);
    await new ClaudeResearchProvider(kernel).research({ topic: "x" });
    expect(seen.request?.promptId).toBe("research.user");
    expect(seen.request?.systemPromptId).toBe("research.system");
    expect(seen.request?.webSearch?.maxUses).toBeGreaterThan(0);
  });

  it("turns API citations into references (not URLs scraped from prose)", async () => {
    const citations: Citation[] = [{ url: "https://fda.gov/x", title: "FDA" }];
    const { kernel } = stubKernel(BRIEFING, citations);
    const result = await new ClaudeResearchProvider(kernel).research({ topic: "x" });
    expect(result.references).toEqual([{ title: "FDA", url: "https://fda.gov/x" }]);
    expect(result.warnings).toHaveLength(0);
    expect(result.metadata.webSearchCount).toBe(2);
  });

  it("REGRESSION: strips the model's tool narration from the summary", async () => {
    // With web search on, the model prepends commentary before the real briefing.
    const narrated =
      "I'll research current facts before writing the briefing.\n\n" +
      "I have enough verified data to write the briefing.\n\n" +
      BRIEFING;
    const { kernel } = stubKernel(narrated);
    const result = await new ClaudeResearchProvider(kernel).research({ topic: "x" });
    expect(result.summary).toBe("Real summary sentence one. Real summary sentence two.");
    expect(result.summary).not.toContain("I'll research");
    expect(result.summary).not.toContain("enough verified data");
    expect(result.keyPoints).toHaveLength(5);
  });

  it("warns when no sources were cited", async () => {
    const { kernel } = stubKernel(BRIEFING);
    const result = await new ClaudeResearchProvider(kernel).research({ topic: "x" });
    expect(result.references).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes("no cited sources"))).toBe(true);
  });
});
