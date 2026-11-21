import { describe, it, expect } from "vitest";
import { wantsCompilation, bitrateForBudget } from "./compile.js";
import { shouldCompile, stripExtras } from "./run-clip-job.js";
import { findCutBursts } from "./scene-detect.js";
import type { SceneCut } from "./scene-detect.js";
import type { ClipJob } from "./run-clip-job.js";
import { planForTheme } from "./themes.js";

const job = (over: Partial<ClipJob> = {}): ClipJob => ({
  url: "https://example.com/v",
  theme: "the goals",
  count: 5,
  ...over,
});

describe("findCutBursts", () => {
  const cuts = (seconds: number[]): SceneCut[] => seconds.map((second) => ({ second, score: 0.6 }));

  it("groups cuts that arrive close together", () => {
    const bursts = findCutBursts(cuts([10, 12, 14, 200, 202, 204, 206]));
    expect(bursts).toHaveLength(2);
    // Densest first — more replay angles means the bigger moment.
    expect(bursts[0]!.cuts).toBe(4);
    expect(bursts[0]!.startSecond).toBe(200);
  });

  it("ignores a lone cut — an ordinary edit is not a highlight", () => {
    expect(findCutBursts(cuts([10, 400, 800]))).toHaveLength(0);
  });

  it("splits on a gap wider than the window", () => {
    const bursts = findCutBursts(cuts([10, 12, 30, 32]));
    expect(bursts).toHaveLength(2);
  });

  it("is safe on an empty list", () => {
    expect(findCutBursts([])).toEqual([]);
  });

  it("does not care what order the cuts arrive in", () => {
    const shuffled = findCutBursts(cuts([204, 10, 202, 14, 200, 12, 206]));
    expect(shuffled).toHaveLength(2);
    expect(shuffled[0]!.cuts).toBe(4);
  });
});

describe("wantsCompilation", () => {
  it("reads a request for one video", () => {
    for (const text of ["the goals as one video", "make it a reel", "all in one", "a compilation"]) {
      expect(wantsCompilation(text)).toBe(true);
    }
  });

  it("reads a request for separate files", () => {
    for (const text of ["send them separately", "as individual clips", "one at a time"]) {
      expect(wantsCompilation(text)).toBe(false);
    }
  });

  it("says nothing when the user said nothing", () => {
    expect(wantsCompilation("the goals")).toBeUndefined();
    expect(wantsCompilation("funniest moments")).toBeUndefined();
  });

  it("lets a request to separate win over the word 'together'", () => {
    expect(wantsCompilation("not together — send them separately")).toBe(false);
  });
});

describe("shouldCompile", () => {
  it("joins sports moments by default — 'the goals' is one video", () => {
    expect(shouldCompile(job(), "the goals", planForTheme("the goals"), "mixed", 5)).toBe(true);
  });

  it("keeps speech moments separate by default", () => {
    expect(shouldCompile(job({ theme: "key insights" }), "key insights", planForTheme("key insights"), "speech", 5)).toBe(false);
  });

  it("honours the user's words over the default, both ways", () => {
    expect(shouldCompile(job(), "the goals, send them separately", planForTheme("the goals"), "mixed", 5)).toBe(false);
    expect(shouldCompile(job(), "key insights in one video", planForTheme("key insights"), "speech", 5)).toBe(true);
  });

  it("honours an explicit flag over everything", () => {
    expect(shouldCompile(job({ compile: false }), "the goals", planForTheme("the goals"), "mixed", 5)).toBe(false);
    expect(shouldCompile(job({ compile: true }), "key insights", planForTheme("key insights"), "speech", 5)).toBe(true);
  });

  it("never joins a single clip", () => {
    expect(shouldCompile(job(), "the goals", planForTheme("the goals"), "mixed", 1)).toBe(false);
  });
});

describe("stripExtras keeps the subject but drops the packaging", () => {
  it("removes one-video and separate-clip instructions", () => {
    expect(stripExtras("the goals as one video")).toBe("the goals");
    expect(stripExtras("the goals, send them separately")).toBe("the goals");
  });

  it("leaves a theme that is only an instruction alone", () => {
    // Stripping to nothing would leave the selector with no subject at all.
    expect(stripExtras("one video")).toBe("one video");
  });
});

/**
 * The joined reel has to fit through the upload. The first one did not: four
 * goals at 1080p CRF 20 came to 66 MB, the Bot API refused it at 50, and the
 * chat reported a clipping failure about clips that had rendered perfectly.
 */
describe("bitrateForBudget", () => {
  const mb = (n: number) => n * 1024 * 1024;

  it("fits a minute of footage into the budget", () => {
    const kbps = bitrateForBudget(62, mb(44))!;
    // Sanity-check the arithmetic the other way round: bits back into bytes.
    const bytes = ((kbps + 160) * 1000 * 62) / 8;
    expect(bytes).toBeLessThanOrEqual(mb(44));
    expect(bytes).toBeGreaterThan(mb(40));
  });

  it("gives a longer reel proportionally less", () => {
    expect(bitrateForBudget(240, mb(44))!).toBeLessThan(bitrateForBudget(60, mb(44))!);
  });

  it("refuses to go below a watchable floor", () => {
    expect(bitrateForBudget(3600, mb(44))).toBe(800);
  });

  it("imposes no cap when there is no limit", () => {
    expect(bitrateForBudget(62, Number.POSITIVE_INFINITY)).toBeUndefined();
  });

  it("is safe on a zero duration", () => {
    expect(bitrateForBudget(0, mb(44))).toBeUndefined();
  });
});
