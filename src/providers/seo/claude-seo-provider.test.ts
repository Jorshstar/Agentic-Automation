import { describe, it, expect } from "vitest";
import { ClaudeSeoProvider } from "./claude-seo-provider.js";
import type { SeoRequest } from "./types.js";
import type { AIKernel, AIGenerateRequest, AIGenerateResult } from "../../ai/index.js";

/** A stub kernel that returns a canned string (or throws) — no network. */
function stubKernel(output: string | Error): AIKernel {
  return {
    async generate<TOutput = unknown>(_request: AIGenerateRequest): Promise<AIGenerateResult<TOutput>> {
      if (output instanceof Error) {
        throw output;
      }
      return {
        output: output as TOutput,
        promptId: "seo.user",
        promptVersion: "v1",
        provider: "claude",
        model: "stub",
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: 0 },
        latencyMs: 1,
        citations: [],
        searchResults: [],
        webSearchCount: 0,
      };
    },
  };
}

const REQUEST: SeoRequest = {
  topic: "The 4th Floor Button",
  hook: "The elevator has a button for a floor that doesn't exist.",
  script: "A short scary narration.",
  niche: "Scary Stories",
  tone: "eerie",
  audience: "horror fans",
  keywords: ["scary stories", "elevator"],
  durationSeconds: 65,
};

describe("ClaudeSeoProvider", () => {
  it("parses a well-formed response and normalizes hashtags", async () => {
    const provider = new ClaudeSeoProvider(
      stubKernel(
        JSON.stringify({
          youtube: {
            title: "The Button That Shouldn't Exist",
            description: "A creepy ride. Like and subscribe.",
            tags: ["Scary Stories", "elevator horror"],
            hashtags: ["#horror", "creepy pasta"], // one missing '#', one with a space
          },
          tiktok: { caption: "Would you press it?", hashtags: ["#horror"] },
          thumbnailText: "floor 13 exists",
        }),
      ),
    );

    const pack = await provider.generate(REQUEST);
    expect(pack.youtube.title).toBe("The Button That Shouldn't Exist");
    expect(pack.youtube.tags).toContain("scary stories"); // lowercased
    expect(pack.youtube.hashtags).toContain("#shorts"); // forced
    expect(pack.youtube.hashtags).toContain("#creepypasta"); // '#' added, space stripped
    expect(pack.tiktok.hashtags).toContain("#fyp"); // forced
    expect(pack.thumbnailText).toBe("FLOOR 13 EXISTS"); // upper-cased
    expect(pack.warnings).toEqual([]);
  });

  it("falls back to usable metadata when the model returns garbage", async () => {
    const provider = new ClaudeSeoProvider(stubKernel("not json at all"));
    const pack = await provider.generate(REQUEST);

    expect(pack.youtube.title).toBe(REQUEST.topic); // fallback = topic
    expect(pack.youtube.hashtags).toContain("#shorts");
    expect(pack.tiktok.caption.length).toBeGreaterThan(0);
    expect(pack.warnings.length).toBeGreaterThan(0); // loudly imperfect
  });

  it("NEVER throws — a kernel failure degrades to the fallback pack", async () => {
    const provider = new ClaudeSeoProvider(stubKernel(new Error("API down")));
    const pack = await provider.generate(REQUEST);

    expect(pack.youtube.title).toBe(REQUEST.topic);
    expect(pack.thumbnailText.length).toBeGreaterThan(0);
    expect(pack.warnings.some((w) => w.code === "generation-failed")).toBe(true);
  });
});
