import { describe, it, expect } from "vitest";
import { buildAss, toCaptionWords, assTime } from "./captions.js";
import type { CaptionWord } from "./captions.js";

const words = (...specs: [string, number, number][]): CaptionWord[] =>
  specs.map(([word, start, end]) => ({ word, start, end }));

/** The TEXT field of a Dialogue line — everything after the 9th comma. */
const textOf = (line: string): string => line.split(",").slice(9).join(",");

describe("assTime", () => {
  it("formats h:mm:ss.cc", () => {
    expect(assTime(0)).toBe("0:00:00.00");
    expect(assTime(61.5)).toBe("0:01:01.50");
    expect(assTime(3661.25)).toBe("1:01:01.25");
  });

  it("never emits a negative timestamp", () => {
    expect(assTime(-5)).toBe("0:00:00.00");
  });
});

describe("buildAss", () => {
  const base = { width: 1080, height: 1920, preset: "bold-yellow" as const, durationSeconds: 10 };

  it("emits one event per word so each can be highlighted", () => {
    const ass = buildAss({ ...base, words: words(["one", 0, 0.5], ["two", 0.5, 1], ["three", 1, 1.5]) });
    const events = ass.split("\n").filter((line) => line.startsWith("Dialogue:"));
    expect(events).toHaveLength(3);
  });

  it("highlights exactly one word per event and shows the whole line", () => {
    const ass = buildAss({ ...base, words: words(["one", 0, 0.5], ["two", 0.5, 1]) });
    const first = ass.split("\n").find((line) => line.startsWith("Dialogue:"))!;
    expect(first).toContain("ONE");
    expect(first).toContain("TWO"); // the rest of the line stays visible
    expect((first.match(/\\c&H/gu) ?? [])).toHaveLength(1); // only one colour override
  });

  it("holds each word until the next begins so the line never blinks out", () => {
    // A 0.4s gap between words: the first event must cover it.
    const ass = buildAss({ ...base, words: words(["one", 0, 0.2], ["two", 0.6, 0.9]) });
    const first = ass.split("\n").find((line) => line.startsWith("Dialogue:"))!;
    expect(first).toContain("0:00:00.60"); // ends where the next word starts
  });

  it("breaks lines on a pause rather than running words together", () => {
    const ass = buildAss({
      ...base,
      words: words(["a", 0, 0.2], ["b", 0.2, 0.4], ["c", 2.0, 2.2]),
    });
    const events = ass.split("\n").filter((line) => line.startsWith("Dialogue:"));
    // "c" is on its own line after the 1.6s pause, so its event shows only "C".
    const last = events.at(-1)!;
    expect(last).toContain("C");
    expect(last).not.toContain("A B");
  });

  it("respects the preset word cap", () => {
    const many = words(["a", 0, 0.2], ["b", 0.2, 0.4], ["c", 0.4, 0.6], ["d", 0.6, 0.8]);
    // impact-red caps at 2 words per line.
    const ass = buildAss({ ...base, preset: "impact-red", words: many });
    const first = ass.split("\n").find((line) => line.startsWith("Dialogue:"))!;
    // Compare the TEXT field only — the style name "Caption" contains a C.
    expect(textOf(first)).toContain("A");
    expect(textOf(first)).toContain("B");
    expect(textOf(first)).not.toContain("C");
  });

  it("strips characters that would be read as ASS markup", () => {
    const ass = buildAss({ ...base, words: words(["{\\pos(1,1)}evil", 0, 0.5]) });
    const event = ass.split("\n").find((line) => line.startsWith("Dialogue:"))!;
    expect(event).not.toContain("\\pos");
    expect(event).toContain("EVIL");
  });

  it("burns a hook card at the top when one is given", () => {
    const ass = buildAss({ ...base, words: [], hook: "He scored from the halfway line" });
    expect(ass).toContain("Style: Hook");
    const hook = ass.split("\n").find((line) => line.includes(",Hook,"))!;
    expect(hook).toContain("\\fad(");
    expect(hook).toContain("HALFWAY");
  });

  it("keeps captions clear of the platform UI at the bottom", () => {
    const ass = buildAss({ ...base, words: words(["x", 0, 0.5]) });
    const style = ass.split("\n").find((line) => line.startsWith("Style: Caption"))!;
    const marginV = Number(style.split(",").at(-2));
    expect(marginV).toBeGreaterThan(1920 * 0.2);
  });

  it("produces a valid file with no words and no hook", () => {
    const ass = buildAss({ ...base, words: [] });
    expect(ass).toContain("[Events]");
    expect(ass.split("\n").filter((line) => line.startsWith("Dialogue:"))).toHaveLength(0);
  });
});

describe("toCaptionWords", () => {
  const source = [
    { word: "before", start: 1, end: 2 },
    { word: "inside", start: 11, end: 12 },
    { word: "after", start: 30, end: 31 },
  ];

  it("keeps only the words inside the clip and rebases them to zero", () => {
    const result = toCaptionWords(source, 10, 20);
    expect(result).toHaveLength(1);
    expect(result[0]!.word).toBe("inside");
    expect(result[0]!.start).toBeCloseTo(1);
    expect(result[0]!.end).toBeCloseTo(2);
  });

  it("clamps a word that straddles the clip edge", () => {
    const result = toCaptionWords([{ word: "edge", start: 9.5, end: 10.5 }], 10, 20);
    expect(result[0]!.start).toBe(0);
    expect(result[0]!.end).toBeCloseTo(0.5);
  });
});


describe("landscape frames", () => {
  const landscape = { width: 1920, height: 1080, preset: "bold-yellow" as const, durationSeconds: 10 };

  it("keeps captions low instead of parking them across the picture", () => {
    const ass = buildAss({ ...landscape, words: [{ word: "x", start: 0, end: 1 }] });
    const style = ass.split("\n").find((line) => line.startsWith("Style: Caption"))!;
    const marginV = Number(style.split(",").at(-2));
    // A quarter of the way up a 1080-tall frame would sit over the action.
    expect(marginV).toBeLessThan(1080 * 0.15);
    expect(marginV).toBeGreaterThan(0);
  });

  it("boosts text on a short frame so it is not undersized", () => {
    const sizeOf = (ass: string): number =>
      Number(ass.split("\n").find((l) => l.startsWith("Style: Caption"))!.split(",")[2]);
    const word = [{ word: "x", start: 0, end: 1 }];
    const wide = sizeOf(buildAss({ ...landscape, words: word }));
    const square = sizeOf(
      buildAss({ width: 1080, height: 1080, preset: "bold-yellow", durationSeconds: 10, words: word }),
    );
    // Same height, but the landscape frame is wider, so its text is boosted.
    expect(wide).toBeGreaterThan(1080 / 17);
    expect(wide).toBe(square); // both are landscape-or-square at this height
    // And it stays a sane fraction of the frame.
    expect(wide).toBeLessThan(1080 * 0.12);
  });

  it("still declares the real frame size so nothing is stretched", () => {
    const ass = buildAss({ ...landscape, words: [] });
    expect(ass).toContain("PlayResX: 1920");
    expect(ass).toContain("PlayResY: 1080");
  });
});
