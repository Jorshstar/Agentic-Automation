import { describe, it, expect } from "vitest";
import type { AIKernel, AIGenerateRequest, AIGenerateResult } from "../../ai/index.js";
import { ClaudePodcastScriptProvider } from "./claude-podcast-script-provider.js";
import type { PodcastScriptRequest } from "./types.js";

function stubKernel(output: string): AIKernel {
  return {
    async generate<TOutput = unknown>(request: AIGenerateRequest): Promise<AIGenerateResult<TOutput>> {
      return {
        output: output as unknown as TOutput,
        promptId: request.promptId,
        promptVersion: "v1",
        provider: "mock",
        model: "stub",
        usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10, costUsd: 0 },
        latencyMs: 1,
        citations: [],
        searchResults: [],
        webSearchCount: 0,
      };
    },
  };
}

const REQUEST: PodcastScriptRequest = {
  topic: "AI and jobs",
  research: {
    summary: "AI changes work.",
    keyPoints: ["point"],
    references: [],
    warnings: [],
    metadata: {
      promptId: "x",
      promptVersion: "v1",
      provider: "claude",
      model: "m",
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      latencyMs: 0,
    },
  },
  tone: "fun",
  audience: "devs",
  language: "English",
  minWords: 140,
  maxWords: 158,
};

describe("ClaudePodcastScriptProvider", () => {
  it("parses a valid two-host script and counts words", async () => {
    const script = await new ClaudePodcastScriptProvider(
      stubKernel(
        JSON.stringify({
          cast: [
            { name: "Maya", voice: "nova", voiceInstructions: "bright", persona: "young woman" },
            { name: "Deji", voice: "onyx", voiceInstructions: "deep", persona: "relaxed man" },
          ],
          turns: [
            { speaker: "Maya", text: "So will AI take our jobs?", emotion: "curious" },
            { speaker: "Deji", text: "Not exactly — but it will change them.", emotion: "wry" },
          ],
        }),
      ),
    ).write(REQUEST);
    expect(script.cast[0].name).toBe("Maya");
    expect(script.turns).toHaveLength(2);
    expect(script.totalWords).toBe(6 + 8);
    expect(script.warnings).toHaveLength(0);
  });

  it("forces two DIFFERENT valid voices and reassigns unknown speakers", async () => {
    const script = await new ClaudePodcastScriptProvider(
      stubKernel(
        JSON.stringify({
          cast: [
            { name: "A", voice: "onyx", voiceInstructions: "", persona: "" },
            { name: "B", voice: "onyx", voiceInstructions: "", persona: "" },
          ],
          turns: [{ speaker: "Charlie", text: "hello there", emotion: "warm" }],
        }),
      ),
    ).write(REQUEST);
    expect(script.cast[0].voice).not.toBe(script.cast[1].voice);
    expect(["A", "B"]).toContain(script.turns[0]?.speaker);
    expect(script.warnings.length).toBeGreaterThan(0);
  });

  it("degrades to default cast + warning on garbage output", async () => {
    const script = await new ClaudePodcastScriptProvider(stubKernel("nonsense")).write(REQUEST);
    expect(script.cast).toHaveLength(2);
    expect(script.cast[0].voice).not.toBe(script.cast[1].voice);
    expect(script.turns).toHaveLength(0);
    expect(script.warnings.some((w) => w.code === "parse-error")).toBe(true);
  });
});
