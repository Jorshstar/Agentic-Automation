import { describe, it, expect } from "vitest";
import { wantsCaptions, wantsTightening, wantsOverlaysGone, stripExtras } from "./run-clip-job.js";

/**
 * Nothing is added to a clip unless the user asked for it. These guard that
 * promise: a plain clip request must switch NOTHING on.
 */
describe("nothing is added unless asked", () => {
  const plainRequests = [
    "the goals",
    "funniest moments",
    "clip the key insights",
    "emotional moments",
    "auto",
    "",
    "clip this video",
    "give me 3 clips of the best bits",
  ];

  it("adds no captions to an ordinary request", () => {
    for (const text of plainRequests) expect(wantsCaptions(text)).toBe(false);
  });

  it("cuts nothing out of an ordinary request", () => {
    for (const text of plainRequests) expect(wantsTightening(text)).toBe(false);
  });

  it("erases nothing from an ordinary request", () => {
    for (const text of plainRequests) expect(wantsOverlaysGone(text)).toBe(false);
  });
});

describe("wantsCaptions", () => {
  it("fires only when asked", () => {
    for (const text of [
      "add captions",
      "clip the goals with subtitles",
      "put captions on it",
      "include subtitles",
      "I want captions",
    ]) {
      expect(wantsCaptions(text)).toBe(true);
    }
  });

  it("does NOT fire on a request to remove the source's own captions", () => {
    // "remove the caption" is about burned-in text in the SOURCE. Reading it as
    // a request to ADD captions would do the exact opposite of what was asked.
    for (const text of ["remove the caption", "take off the subtitles", "get rid of the text"]) {
      expect(wantsCaptions(text)).toBe(false);
      expect(wantsOverlaysGone(text)).toBe(true);
    }
  });
});

describe("wantsTightening", () => {
  it("fires only when asked", () => {
    for (const text of ["tighten it up", "cut the pauses", "remove the dead air", "make it snappy"]) {
      expect(wantsTightening(text)).toBe(true);
    }
  });
});


describe("stripExtras", () => {
  it("leaves the subject and drops the instructions", () => {
    expect(stripExtras("the funniest moments, remove the watermark")).toBe("the funniest moments");
    expect(stripExtras("key insights, with subtitles")).toBe("key insights");
    expect(stripExtras("the goals, vertical")).toBe("the goals");
    expect(stripExtras("the goals, make it vertical, cut the pauses")).toBe("the goals");
  });

  it("leaves an ordinary theme untouched", () => {
    for (const theme of ["the goals", "funniest moments", "emotional moments", "auto"]) {
      expect(stripExtras(theme)).toBe(theme);
    }
  });

  it("keeps the text when it is ONLY an instruction", () => {
    // Something still has to be selected, so returning "" would be worse.
    expect(stripExtras("remove the watermark")).toBe("remove the watermark");
  });

  it("does not change which extras fire", () => {
    const full = "the funniest moments, remove the watermark";
    expect(wantsOverlaysGone(full)).toBe(true);
    expect(stripExtras(full)).toBe("the funniest moments");
  });
});
