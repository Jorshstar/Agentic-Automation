import { describe, it, expect } from "vitest";
import { DEFAULT_RUN_SETTINGS, buildQaContext, buildMusicGenerationContext } from "./niche-context.js";
import { getNicheProfile } from "./niche-profiles.js";

describe("duration windows derive from the run target", () => {
  it("65s target keeps the original Shorts window (60/72)", () => {
    const qa = buildQaContext({ ...DEFAULT_RUN_SETTINGS, targetDurationSeconds: 65 });
    expect(qa.minDurationSeconds).toBe(60);
    expect(qa.maxDurationSeconds).toBe(72);
  });

  it("a 90s brief gets a proportional window (83/100)", () => {
    const qa = buildQaContext({ ...DEFAULT_RUN_SETTINGS, targetDurationSeconds: 90 });
    expect(qa.minDurationSeconds).toBe(83);
    expect(qa.maxDurationSeconds).toBe(100);
  });
});

describe("music preset comes from the profile", () => {
  it("each preset niche maps to its own synth preset", () => {
    expect(buildMusicGenerationContext(getNicheProfile("scary-stories")).mood).toBe("tense-drone");
    expect(buildMusicGenerationContext(getNicheProfile("tech-news")).mood).toBe("upbeat-electronic");
  });
});
