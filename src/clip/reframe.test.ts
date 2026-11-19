import { describe, it, expect } from "vitest";
import {
  cropXExpression,
  cropWidthFor,
  smooth,
  defaultModeForTheme,
  parseLayoutInstruction,
  WIDE_CROP_ASPECT,
} from "./reframe.js";
import { planForTheme } from "./themes.js";

describe("cropWidthFor", () => {
  it("cuts a 9:16 window out of a 16:9 source", () => {
    expect(cropWidthFor(1920, 1080)).toBe(608); // round(1080 * 9/16) = 608, already even
  });

  it("never asks for more width than the source has", () => {
    expect(cropWidthFor(640, 1920)).toBeLessThanOrEqual(640);
  });

  it("always returns an even width (odd offsets corrupt yuv420p)", () => {
    for (const [w, h] of [[1920, 1080], [1280, 720], [854, 480], [3840, 2160]]) {
      expect(cropWidthFor(w!, h!) % 2).toBe(0);
    }
  });
});

describe("cropXExpression", () => {
  const width = 1920;
  const crop = cropWidthFor(1920, 1080); // 606

  it("centres the window when there are no keyframes", () => {
    expect(cropXExpression([], width, crop)).toBe(String(Math.round((width - crop) / 2)));
  });

  it("returns a plain number for a static crop", () => {
    const expression = cropXExpression([{ second: 0, xCenter: 0.5 }], width, crop);
    expect(Number(expression)).toBeCloseTo(960 - crop / 2, 0);
    expect(expression).not.toContain("if(");
  });

  it("clamps a subject at the far left to the frame edge", () => {
    expect(cropXExpression([{ second: 0, xCenter: 0 }], width, crop)).toBe("0");
  });

  it("clamps a subject at the far right to the last valid offset", () => {
    expect(cropXExpression([{ second: 0, xCenter: 1 }], width, crop)).toBe(String(width - crop));
  });

  it("builds a piecewise ramp for a moving subject, clamped and even", () => {
    const expression = cropXExpression(
      [
        { second: 0, xCenter: 0.3 },
        { second: 5, xCenter: 0.7 },
      ],
      width,
      crop,
    );
    expect(expression).toContain("if(lt(t,5)");
    expect(expression).toContain("trunc(");
    expect(expression).toContain("min(max(");
    // ffmpeg's `t` is the clip clock, so the ramp must be written in t.
    expect(expression).toContain("(t-0)");
  });

  it("does not divide by zero when two keyframes share a timestamp", () => {
    const expression = cropXExpression(
      [
        { second: 2, xCenter: 0.3 },
        { second: 2, xCenter: 0.7 },
      ],
      width,
      crop,
    );
    expect(expression).not.toContain("/0");
    expect(expression).not.toContain("NaN");
  });
});

describe("smooth", () => {
  it("averages out per-frame jitter but keeps the endpoints", () => {
    const input = [
      { second: 0, xCenter: 0.5 },
      { second: 1, xCenter: 0.9 }, // a single bad estimate
      { second: 2, xCenter: 0.5 },
    ];
    const result = smooth(input);
    expect(result[0]!.xCenter).toBe(0.5);
    expect(result[2]!.xCenter).toBe(0.5);
    expect(result[1]!.xCenter).toBeCloseTo(0.633, 2);
  });

  it("leaves one or two keyframes alone", () => {
    expect(smooth([{ second: 0, xCenter: 0.2 }])).toHaveLength(1);
  });
});

describe("defaultModeForTheme", () => {
  it("leaves every theme at its original size by default", () => {
    // Converting to vertical always costs something — padding or cropping — so
    // it is opt-in. A clip should look like the video it came from.
    for (const theme of ["the goals", "emotional moments", "key insights", "funny", "auto"]) {
      expect(defaultModeForTheme(planForTheme(theme))).toBe("native");
    }
  });

  it("honours a plain-words CLIP_REFRAME, not just a mode name", () => {
    process.env.CLIP_REFRAME = "show the whole video";
    expect(defaultModeForTheme(planForTheme("emotional moments"))).toBe("fit");
    delete process.env.CLIP_REFRAME;
  });

  it("honours a CLIP_REFRAME override", () => {
    process.env.CLIP_REFRAME = "fit";
    expect(defaultModeForTheme(planForTheme("the goals"))).toBe("fit");
    delete process.env.CLIP_REFRAME;
  });
});


describe("cropWidthFor with a wide window", () => {
  it("keeps more of the scene than a 9:16 crop", () => {
    const tall = cropWidthFor(1920, 1080);
    const wide = cropWidthFor(1920, 1080, WIDE_CROP_ASPECT);
    expect(wide).toBeGreaterThan(tall);
    expect(wide % 2).toBe(0);
  });
});

describe("parseLayoutInstruction", () => {
  it("understands a request to fill the screen", () => {
    for (const text of [
      "full screen",
      "fill the screen",
      "make it like tiktok",
      "zoom in on him",
      "close up please",
      "make it vertical",
    ]) {
      expect(parseLayoutInstruction(text)).toBe("smart");
    }
  });

  it("understands a request to keep the whole picture", () => {
    for (const text of [
      "show the whole video",
      "show me the full frame",
      "don't crop it",
      "do not crop the sides",
      "keep the sides",
      "uncropped",
    ]) {
      expect(parseLayoutInstruction(text)).toBe("fit");
    }
  });

  it("understands a request for something in between", () => {
    for (const text of ["wider please", "show more of the room", "zoom out a bit"]) {
      expect(parseLayoutInstruction(text)).toBe("wide");
    }
  });

  it("prefers 'show the whole video' over the word full", () => {
    // "full" alone suggests full-screen, but an explicit request to keep the
    // whole picture is the more specific instruction.
    expect(parseLayoutInstruction("show the full video")).toBe("fit");
  });

  it("still accepts bare mode names", () => {
    expect(parseLayoutInstruction("smart")).toBe("smart");
    expect(parseLayoutInstruction("wide")).toBe("wide");
    expect(parseLayoutInstruction("fit")).toBe("fit");
    expect(parseLayoutInstruction("fit-top")).toBe("fit-top");
  });

  it("reads 'no blur' and 'no bars' as keep-it-original, not crop", () => {
    // These ask for the padding to go away, and the way to have no padding is
    // to not build a vertical canvas in the first place.
    for (const text of ["no blur", "no bars", "no padding", "leave it as it was", "same size"]) {
      expect(parseLayoutInstruction(text)).toBe("native");
    }
  });

  it("returns undefined when no layout is mentioned, leaving the default", () => {
    expect(parseLayoutInstruction("")).toBeUndefined();
    expect(parseLayoutInstruction("the funniest moments")).toBeUndefined();
    expect(parseLayoutInstruction("key insights")).toBeUndefined();
  });
});
