import { describe, it, expect } from "vitest";
import { DEFAULT_RUN_SETTINGS, buildQaContext, buildMusicGenerationContext } from "./niche-context.js";
import { getNicheProfile } from "./niche-profiles.js";

describe("duration windows derive from the run target", () => {
  it("65s target derives a natural-pace window (0.85x / 1.2x)", () => {
    const qa = buildQaContext({ ...DEFAULT_RUN_SETTINGS, targetDurationSeconds: 65 });
    expect(qa.minDurationSeconds).toBe(55); // 65 * 0.85
    expect(qa.maxDurationSeconds).toBe(78); // 65 * 1.2
  });

  it("a 90s brief gets a proportional window", () => {
    const qa = buildQaContext({ ...DEFAULT_RUN_SETTINGS, targetDurationSeconds: 90 });
    expect(qa.minDurationSeconds).toBe(77); // 90 * 0.85
    expect(qa.maxDurationSeconds).toBe(108); // 90 * 1.2
  });
});

describe("music preset comes from the profile", () => {
  it("each preset niche maps to its own synth preset", () => {
    expect(buildMusicGenerationContext(getNicheProfile("scary-stories")).mood).toBe("tense-drone");
    expect(buildMusicGenerationContext(getNicheProfile("tech-news")).mood).toBe("upbeat-electronic");
  });
});
