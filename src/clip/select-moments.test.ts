import { describe, it, expect } from "vitest";
import {
  selectFromSignals,
  removeOverlaps,
  condensePeaks,
  describeEvents,
  ClipMomentSelector,
} from "./select-moments.js";
import type { AIKernel } from "../ai/index.js";
import type { ClipMoment, SelectInput } from "./select-moments.js";
import type { AudioAnalysis, AudioEvent } from "./audio-energy.js";
import type { SceneCut } from "./scene-detect.js";
import { planForTheme } from "./themes.js";

const surge = (start: number, length: number, prominenceDb: number): AudioEvent => ({
  startSecond: start,
  endSecond: start + length,
  durationSeconds: length,
  peakDb: -10,
  prominenceDb,
  kind: length >= 1.5 ? "surge" : "spike",
});

const cutsAround = (second: number, count: number): SceneCut[] =>
  Array.from({ length: count }, (_, i) => ({ second: second + i * 1.5, score: 0.6 }));

const audio = (events: AudioEvent[]): AudioAnalysis => ({
  baselineDb: -30,
  peaks: [],
  events,
  silences: [],
});

const input = (over: Partial<SelectInput> = {}): SelectInput => ({
  plan: planForTheme("the goals"),
  mode: "action",
  count: 5,
  title: "Match highlights",
  description: "",
  durationSeconds: 3600,
  segments: [],
  audio: audio([]),
  sceneCuts: [],
  chapters: [],
  ...over,
});

describe("selectFromSignals — the goals case", () => {
  it("finds a clip around each sustained crowd surge", () => {
    const events = [surge(600, 8, 16), surge(1500, 7, 15), surge(2400, 6, 14)];
    const moments = selectFromSignals(input({ audio: audio(events) }));
    expect(moments).toHaveLength(3);
    for (const moment of moments) {
      const covers = events.some((e) => e.startSecond >= moment.startSecond && e.startSecond <= moment.endSecond);
      expect(covers).toBe(true);
    }
  });

  it("starts before the roar so the build-up play is in the clip", () => {
    const moments = selectFromSignals(input({ audio: audio([surge(600, 8, 16)]) }));
    expect(moments[0]!.startSecond).toBeLessThan(600);
    expect(600 - moments[0]!.startSecond).toBeGreaterThanOrEqual(5);
  });

  it("keeps goal clips short", () => {
    const moments = selectFromSignals(input({ audio: audio([surge(600, 8, 16), surge(1500, 6, 14)]) }));
    const plan = planForTheme("the goals");
    for (const moment of moments) {
      expect(moment.endSecond - moment.startSecond).toBeLessThanOrEqual(plan.duration.max);
    }
  });

  it("ranks a surge backed by replay cuts above a lone surge", () => {
    const withReplays = surge(600, 6, 14);
    const withoutReplays = surge(1500, 6, 14);
    const moments = selectFromSignals(
      input({
        count: 2,
        audio: audio([withReplays, withoutReplays]),
        sceneCuts: cutsAround(607, 5),
      }),
    );
    const goal = moments.find((m) => m.startSecond < 700)!;
    const other = moments.find((m) => m.startSecond > 700)!;
    expect(goal.score).toBeGreaterThan(other.score);
    expect(goal.evidence.join(" ")).toContain("replay cuts");
  });

  it("returns clips in chronological order with 0-100 scores", () => {
    const moments = selectFromSignals(
      input({ audio: audio([surge(2400, 6, 12), surge(600, 8, 16), surge(1500, 7, 14)]) }),
    );
    const starts = moments.map((m) => m.startSecond);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    for (const moment of moments) {
      expect(moment.score).toBeGreaterThanOrEqual(0);
      expect(moment.score).toBeLessThanOrEqual(100);
    }
  });

  it("never returns overlapping clips", () => {
    // Three surges only seconds apart — the windows would otherwise collide.
    const moments = selectFromSignals(
      input({ audio: audio([surge(600, 4, 16), surge(606, 4, 15), surge(612, 4, 14)]) }),
    );
    for (let i = 1; i < moments.length; i++) {
      expect(moments[i]!.startSecond).toBeGreaterThanOrEqual(moments[i - 1]!.endSecond - 0.5);
    }
  });

  it("never runs past the end of the video", () => {
    const moments = selectFromSignals(
      input({ durationSeconds: 300, audio: audio([surge(295, 4, 16)]) }),
    );
    for (const moment of moments) {
      expect(moment.endSecond).toBeLessThanOrEqual(300);
      expect(moment.startSecond).toBeGreaterThanOrEqual(0);
    }
  });

  it("still returns something when there is no signal at all", () => {
    // The old pipeline returned nothing here and the user got an empty reply.
    const moments = selectFromSignals(input({ audio: audio([]) }));
    expect(moments.length).toBeGreaterThan(0);
    expect(moments[0]!.evidence.join(" ")).toContain("no audio events");
  });

  it("handles a source shorter than one clip", () => {
    const moments = selectFromSignals(input({ durationSeconds: 12, audio: audio([]) }));
    expect(moments).toHaveLength(1);
    expect(moments[0]!.endSecond).toBeLessThanOrEqual(12);
  });

  it("never returns overlapping clips from the no-signal fallback", () => {
    // A 56s TikTok produced [11-33] and [23-45] - ten seconds of the same
    // content delivered twice.
    for (const seconds of [56, 90, 120, 300, 900]) {
      const moments = selectFromSignals(
        input({ durationSeconds: seconds, count: 4, audio: audio([]), plan: planForTheme("funny") }),
      );
      for (let i = 1; i < moments.length; i++) {
        expect(moments[i]!.startSecond).toBeGreaterThanOrEqual(moments[i - 1]!.endSecond);
      }
      for (const moment of moments) {
        expect(moment.endSecond).toBeLessThanOrEqual(seconds);
        expect(moment.endSecond).toBeGreaterThan(moment.startSecond);
      }
    }
  });

  it("treats a short source as one clip rather than slicing near-duplicates", () => {
    const moments = selectFromSignals(
      input({ durationSeconds: 56, count: 3, audio: audio([]), plan: planForTheme("funny") }),
    );
    expect(moments).toHaveLength(1);
    expect(moments[0]!.startSecond).toBe(0);
  });

  it("names the moment from commentary when there is any", () => {
    const moments = selectFromSignals(
      input({
        audio: audio([surge(600, 6, 16)]),
        segments: [{ start: 598, end: 606, text: "Oh that is an absolutely stunning strike from range" }],
      }),
    );
    expect(moments[0]!.hook.toLowerCase()).toContain("stunning");
  });
});

describe("removeOverlaps", () => {
  const moment = (startSecond: number, endSecond: number, score: number): ClipMoment => ({
    startSecond,
    endSecond,
    hook: "",
    reason: "",
    score,
    evidence: [],
  });

  it("keeps the first of a colliding pair (callers pass best-first)", () => {
    const kept = removeOverlaps([moment(10, 30, 90), moment(20, 40, 80), moment(50, 70, 70)]);
    expect(kept.map((m) => m.startSecond)).toEqual([10, 50]);
  });

  it("keeps clips that merely touch", () => {
    expect(removeOverlaps([moment(0, 10, 90), moment(10, 20, 80)])).toHaveLength(2);
  });
});

describe("condensePeaks", () => {
  it("collapses runs of loud seconds into ranges", () => {
    const peaks = [612, 613, 614, 615, 1044].map((second) => ({ second, db: -12 }));
    expect(condensePeaks(peaks)).toBe("612-615, 1044");
  });

  it("is empty for no peaks", () => {
    expect(condensePeaks([])).toBe("");
  });
});

describe("describeEvents", () => {
  it("tells the model about the replay burst, which is the goal tell", () => {
    const description = describeEvents([surge(600, 6, 14)], cutsAround(607, 5));
    expect(description).toContain("surge");
    expect(description).toContain("+14dB");
    expect(description).toContain("replay cuts after");
  });
});


describe("ClipMomentSelector degradation", () => {
  /** A kernel that always fails, like an exhausted API balance. */
  const brokenKernel = (message: string): AIKernel =>
    ({
      generate: async () => {
        throw new Error(message);
      },
    }) as unknown as AIKernel;

  const speechInput = (): SelectInput =>
    input({
      plan: planForTheme("key insights"),
      mode: "speech",
      audio: audio([surge(600, 8, 16), surge(1500, 7, 15)]),
      segments: [{ start: 595, end: 615, text: "here is the single most useful thing I can tell you" }],
    });

  it("falls back to audio detection instead of losing the whole job", async () => {
    // This is the real failure we hit: the source was downloaded and analysed,
    // then selection died on a billing error and the run threw it all away.
    const warnings: string[] = [];
    const selector = new ClipMomentSelector(brokenKernel("credit balance is too low"));
    const moments = await selector.select({ ...speechInput(), onWarn: (m) => warnings.push(m) });

    expect(moments.length).toBeGreaterThan(0);
    expect(warnings.join(" ")).toContain("credit balance is too low");
    expect(warnings.join(" ")).toContain("audio detection");
  });

  it("does not throw even with no onWarn hook", async () => {
    const selector = new ClipMomentSelector(brokenKernel("boom"));
    await expect(selector.select(speechInput())).resolves.toBeDefined();
  });

  it("falls back when the model returns nothing usable", async () => {
    const emptyKernel = { generate: async () => ({ output: '{"clips":[]}' }) } as unknown as AIKernel;
    const moments = await new ClipMomentSelector(emptyKernel).select(speechInput());
    expect(moments.length).toBeGreaterThan(0);
  });

  it("uses the model's picks when it works", async () => {
    const goodKernel = {
      generate: async () => ({
        output: JSON.stringify({
          clips: [
            { startSecond: 100, endSecond: 140, hook: "The one thing", reason: "clear", score: 92 },
          ],
        }),
      }),
    } as unknown as AIKernel;
    const moments = await new ClipMomentSelector(goodKernel).select(speechInput());
    expect(moments).toHaveLength(1);
    expect(moments[0]!.hook).toBe("The one thing");
    expect(moments[0]!.startSecond).toBe(100);
  });
});
