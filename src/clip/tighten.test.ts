import { describe, it, expect } from "vitest";
import { planTighten, mapTime, remapWords, selectExpression } from "./tighten.js";
import type { CaptionWord } from "./captions.js";

/** Dense speech: a word every 0.5s with no gaps. */
const dense = (count: number, step = 0.5): CaptionWord[] =>
  Array.from({ length: count }, (_, i) => ({ word: `w${i}`, start: i * step, end: i * step + 0.45 }));

describe("planTighten guards", () => {
  it("does nothing on a clip that is mostly not speech", () => {
    // Football: four commentary words in a 60s clip. The gaps ARE the match.
    const words: CaptionWord[] = [
      { word: "goal", start: 10, end: 10.5 },
      { word: "what", start: 11, end: 11.4 },
      { word: "a", start: 11.4, end: 11.6 },
      { word: "strike", start: 11.6, end: 12.2 },
      { word: "unbelievable", start: 30, end: 31 },
    ];
    const plan = planTighten(words, 60);
    expect(plan.applied).toBe(false);
    expect(plan.removedSeconds).toBe(0);
    expect(plan.durationSeconds).toBe(60);
  });

  it("does nothing when there is almost nothing to trim", () => {
    const plan = planTighten(dense(40), 20);
    expect(plan.applied).toBe(false);
  });

  it("does nothing with too few words to judge", () => {
    expect(planTighten(dense(3), 10).applied).toBe(false);
  });
});

describe("planTighten", () => {
  it("removes a long internal pause and reports the saving", () => {
    const words: CaptionWord[] = [
      ...dense(20), // 0 .. 9.95
      // 4-second silence, then speech resumes
      ...dense(20).map((w) => ({ ...w, start: w.start + 14, end: w.end + 14 })),
    ];
    const plan = planTighten(words, 24);
    expect(plan.applied).toBe(true);
    expect(plan.removedSeconds).toBeGreaterThan(3);
    expect(plan.durationSeconds).toBeLessThan(24);
    expect(plan.ranges.length).toBe(2);
  });

  it("trims dead air off the start and end", () => {
    const words = dense(30).map((w) => ({ ...w, start: w.start + 3, end: w.end + 3 }));
    const plan = planTighten(words, 22); // 3s lead-in, ~4s tail
    expect(plan.applied).toBe(true);
    expect(plan.ranges[0]!.start).toBeGreaterThan(2);
  });

  it("drops standalone filler sounds", () => {
    const words: CaptionWord[] = [
      ...dense(20),
      { word: "um", start: 10, end: 10.6 },
      { word: "uhhh", start: 11, end: 11.8 },
      ...dense(20).map((w) => ({ ...w, start: w.start + 12, end: w.end + 12 })),
    ];
    const plan = planTighten(words, 22);
    expect(plan.applied).toBe(true);
    const kept = remapWords(plan, words).map((w) => w.word);
    expect(kept).not.toContain("um");
    expect(kept).not.toContain("uhhh");
  });

  it("never removes words that only look like fillers", () => {
    const words: CaptionWord[] = [
      ...dense(20),
      { word: "umbrella", start: 10, end: 10.6 },
      ...dense(20).map((w) => ({ ...w, start: w.start + 14, end: w.end + 14 })),
    ];
    const plan = planTighten(words, 24);
    expect(remapWords(plan, words).map((w) => w.word)).toContain("umbrella");
  });

  it("caps the number of seams", () => {
    // Twenty separate long pauses; we must not stitch twenty fragments.
    const words: CaptionWord[] = [];
    for (let i = 0; i < 20; i++) {
      const base = i * 6;
      words.push(
        { word: `a${i}`, start: base, end: base + 1 },
        { word: `b${i}`, start: base + 1, end: base + 2 },
        { word: `c${i}`, start: base + 2, end: base + 3.6 },
      );
    }
    const plan = planTighten(words, 120, { maxCuts: 5 });
    expect(plan.ranges.length).toBeLessThanOrEqual(6);
  });
});

describe("mapTime", () => {
  const plan = {
    ranges: [
      { start: 0, end: 10 },
      { start: 14, end: 24 },
    ],
    removedSeconds: 4,
    applied: true,
    durationSeconds: 20,
    note: "",
  };

  it("passes times before the cut through unchanged", () => {
    expect(mapTime(plan, 0)).toBe(0);
    expect(mapTime(plan, 7)).toBe(7);
  });

  it("shifts times after the cut back by the removed amount", () => {
    expect(mapTime(plan, 14)).toBe(10);
    expect(mapTime(plan, 20)).toBe(16);
    expect(mapTime(plan, 24)).toBe(20);
  });

  it("collapses a time inside the cut onto the seam", () => {
    expect(mapTime(plan, 12)).toBe(10);
  });

  it("is the identity when the plan is a no-op", () => {
    const noop = { ...plan, applied: false };
    expect(mapTime(noop, 12)).toBe(12);
  });
});

describe("remapWords", () => {
  it("keeps captions in sync with the shortened audio", () => {
    const plan = {
      ranges: [
        { start: 0, end: 5 },
        { start: 9, end: 14 },
      ],
      removedSeconds: 4,
      applied: true,
      durationSeconds: 10,
      note: "",
    };
    const words: CaptionWord[] = [
      { word: "before", start: 1, end: 2 },
      { word: "cut", start: 6, end: 7 },
      { word: "after", start: 10, end: 11 },
    ];
    const result = remapWords(plan, words);
    expect(result.map((w) => w.word)).toEqual(["before", "after"]);
    expect(result[1]!.start).toBeCloseTo(6); // 10s source -> 6s output
  });
});

describe("selectExpression", () => {
  it("sums one between() per kept range", () => {
    const plan = {
      ranges: [
        { start: 0, end: 5 },
        { start: 9, end: 14 },
      ],
      removedSeconds: 4,
      applied: true,
      durationSeconds: 10,
      note: "",
    };
    expect(selectExpression(plan)).toBe("between(t,0,5)+between(t,9,14)");
  });
});
