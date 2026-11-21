import { describe, it, expect } from "vitest";
import { classifyTheme, planForTheme, effectiveMode, isSparseSpeech } from "./themes.js";

describe("classifyTheme", () => {
  it("recognises the phrasings a user actually types", () => {
    expect(classifyTheme("the goals")).toBe("sports-action");
    expect(classifyTheme("just the goals in this football highlight")).toBe("sports-action");
    expect(classifyTheme("every knockout")).toBe("sports-action");
    expect(classifyTheme("funny moments")).toBe("comedy");
    expect(classifyTheme("the funniest bits")).toBe("comedy");
    expect(classifyTheme("emotional moments")).toBe("emotional");
    expect(classifyTheme("the most motivational parts")).toBe("emotional");
    expect(classifyTheme("key insights")).toBe("insight");
    expect(classifyTheme("the arguments")).toBe("conflict");
  });

  it("falls back to auto for a blank or unknown theme", () => {
    expect(classifyTheme("")).toBe("auto");
    expect(classifyTheme("   ")).toBe("auto");
    expect(classifyTheme("auto")).toBe("auto");
    expect(classifyTheme("something nobody has a keyword for")).toBe("auto");
  });
});

describe("planForTheme", () => {
  it("gives goals short clips driven by audio and cuts, not words", () => {
    const plan = planForTheme("the goals");
    expect(plan.mode).toBe("action");
    expect(plan.needsSceneDetection).toBe(true);
    expect(plan.weights.loudness).toBeGreaterThan(plan.weights.transcript);
    expect(plan.duration.ideal).toBeLessThan(25);
    // A goal needs the build-up play before the roar.
    expect(plan.preRollSeconds).toBeGreaterThan(5);
  });

  it("gives emotional clips room and does not chase loudness", () => {
    const plan = planForTheme("emotional moments");
    expect(plan.mode).toBe("speech");
    expect(plan.weights.transcript).toBeGreaterThan(0.7);
    expect(plan.weights.loudness).toBeLessThan(0.2);
    expect(plan.duration.ideal).toBeGreaterThan(planForTheme("the goals").duration.ideal);
  });

  it("gives comedy a long pre-roll so the set-up survives", () => {
    const plan = planForTheme("funniest moments");
    expect(plan.preRollSeconds).toBeGreaterThanOrEqual(12);
  });

  it("keeps the user's own words as the theme", () => {
    expect(planForTheme("  the goals  ").theme).toBe("the goals");
    expect(planForTheme("").theme).toBe("auto");
  });

  it("every family declares weights that roughly sum to one", () => {
    for (const theme of ["the goals", "funny", "emotional", "tips", "argument", "shock", "story", "quote", ""]) {
      const { weights } = planForTheme(theme);
      const total = weights.transcript + weights.loudness + weights.scene;
      expect(total).toBeGreaterThan(0.95);
      expect(total).toBeLessThan(1.05);
    }
  });
});

describe("isSparseSpeech", () => {
  it("treats a music-only highlight reel as speechless", () => {
    expect(isSparseSpeech(0, 600)).toBe(true);
    expect(isSparseSpeech(40, 600)).toBe(true); // 4 wpm
  });

  it("treats normal narration as speech", () => {
    expect(isSparseSpeech(1400, 600)).toBe(false); // 140 wpm
  });
});

describe("effectiveMode", () => {
  it("drops a speech theme into action mode when there is no speech", () => {
    const plan = planForTheme("emotional moments");
    expect(plan.mode).toBe("speech");
    // This is the case that used to return zero clips.
    expect(effectiveMode(plan, 0, 600)).toBe("action");
  });

  it("keeps the planned mode when speech is present", () => {
    const plan = planForTheme("emotional moments");
    expect(effectiveMode(plan, 1400, 600)).toBe("speech");
  });
});

describe("effectiveMode follows what the source actually contains", () => {
  const sports = planForTheme("the goals");

  it("reads the commentary when a sports video has any", () => {
    // 12 minutes of broadcast commentary: ~1500 words.
    expect(effectiveMode(sports, 1500, 720)).toBe("mixed");
  });

  it("falls back to signals on a music-only reel", () => {
    expect(effectiveMode(sports, 20, 720)).toBe("action");
  });

  it("degrades a speech theme that has no speech", () => {
    expect(effectiveMode(planForTheme("key insights"), 0, 600)).toBe("action");
  });

  it("leaves a speech theme alone when there are words", () => {
    expect(effectiveMode(planForTheme("key insights"), 1200, 600)).toBe("speech");
  });
});

describe("compileByDefault", () => {
  it("is set for sport, where the moments are one reel", () => {
    expect(planForTheme("the goals").compileByDefault).toBe(true);
    expect(planForTheme("every knockout").compileByDefault).toBe(true);
  });

  it("is off where each moment stands alone", () => {
    for (const theme of ["key insights", "the emotional bits", "funniest moments", "auto"]) {
      expect(planForTheme(theme).compileByDefault).toBe(false);
    }
  });
});
