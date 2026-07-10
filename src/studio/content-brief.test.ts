import { describe, it, expect, afterAll } from "vitest";
import { rm } from "node:fs/promises";
import type { AIKernel, AIGenerateRequest, AIGenerateResult } from "../ai/index.js";
import { resolveBrief, saveResolvedBrief, loadResolvedBrief } from "./content-brief.js";

/** A stub AI kernel that always returns the given text. */
function stubKernel(output: string): AIKernel {
  return {
    async generate<TOutput = unknown>(request: AIGenerateRequest): Promise<AIGenerateResult<TOutput>> {
      return {
        output: output as unknown as TOutput,
        promptId: request.promptId,
        promptVersion: "v1",
        provider: "mock",
        model: "stub",
        usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20, costUsd: 0 },
        latencyMs: 1,
        citations: [],
        searchResults: [],
        webSearchCount: 0,
      };
    },
  };
}

const VALID_IDENTITY_JSON = JSON.stringify({
  label: "Midnight History",
  audience: "curious night owls",
  tone: "calm, wondrous",
  language: "English",
  pacing: "slow",
  voice: "sage",
  voiceInstructions: "Soft, unhurried, storytelling warmth.",
  visualStyle: "candlelit oil-painting style, soft focus",
  colorMood: "deep ambers and midnight blues",
  musicMood: "gentle drifting pad",
  musicPreset: "warm-pad",
  captionAccent: "#D4A24E",
  captionFont: "Georgia",
  captionPosition: "bottom",
  captionKaraoke: false,
  themes: ["forgotten empires", "ancient mysteries"],
});

describe("resolveBrief", () => {
  it("preset niche + overrides: merges without touching unrelated fields", async () => {
    const resolved = await resolveBrief({
      instructions: "top AI tools this week",
      niche: "tech-news",
      identity: { voice: "onyx" },
      durationSeconds: 90,
    });
    expect(resolved.profile.niche).toBe("tech-news");
    expect(resolved.profile.voice).toBe("onyx"); // override applied
    expect(resolved.profile.captionAccent).toBe("#00E5FF"); // preset intact
    expect(resolved.run.targetDurationSeconds).toBe(90);
    expect(resolved.warnings).toHaveLength(0);
  });

  it("no niche: designs a custom identity from the instructions", async () => {
    const resolved = await resolveBrief(
      { instructions: "a calm bedtime history channel" },
      stubKernel(VALID_IDENTITY_JSON),
    );
    expect(resolved.profile.niche).toBe("custom");
    expect(resolved.profile.label).toBe("Midnight History");
    expect(resolved.profile.voice).toBe("sage");
    expect(resolved.profile.musicPreset).toBe("warm-pad");
    expect(resolved.profile.captionAccent).toBe("#D4A24E");
  });

  it("designer garbage: falls back to a usable neutral identity with warnings", async () => {
    const resolved = await resolveBrief(
      { instructions: "something weird" },
      stubKernel("not json at all"),
    );
    expect(resolved.profile.niche).toBe("custom");
    expect(resolved.profile.voice).toBe("verse"); // fallback voice
    expect(resolved.profile.musicPreset).toBe("neutral");
    expect(resolved.profile.topicThemes).toContain("something weird");
    expect(resolved.warnings.length).toBeGreaterThan(0);
  });

  it("coerces hallucinated enum values to safe defaults", async () => {
    const bad = JSON.parse(VALID_IDENTITY_JSON) as Record<string, unknown>;
    bad["voice"] = "morgan-freeman";
    bad["musicPreset"] = "dubstep";
    bad["captionAccent"] = "gold";
    const resolved = await resolveBrief(
      { instructions: "x" },
      stubKernel(JSON.stringify(bad)),
    );
    expect(resolved.profile.voice).toBe("verse");
    expect(resolved.profile.musicPreset).toBe("neutral");
    expect(resolved.profile.captionAccent).toBe("#FFFFFF");
    expect(resolved.warnings.length).toBeGreaterThanOrEqual(3);
  });
});

describe("brief persistence", () => {
  const runId = "custom-0000-00-00T00-00-00-000Z-brief-test";

  afterAll(async () => {
    await rm(`output/runs/${runId}`, { recursive: true, force: true });
  });

  it("round-trips a resolved brief for resume", async () => {
    const resolved = await resolveBrief(
      { instructions: "roundtrip", durationSeconds: 75 },
      stubKernel(VALID_IDENTITY_JSON),
    );
    await saveResolvedBrief(runId, resolved);
    const loaded = await loadResolvedBrief(runId);
    expect(loaded?.profile.label).toBe("Midnight History");
    expect(loaded?.run.targetDurationSeconds).toBe(75);
  });

  it("returns undefined for runs without a brief", async () => {
    expect(await loadResolvedBrief("no-such-run-9999")).toBeUndefined();
  });
});
