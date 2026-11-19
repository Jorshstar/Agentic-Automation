import { describe, it, expect } from "vitest";
import { parseVtt, isRemoteUrl } from "./source-download.js";

describe("isRemoteUrl", () => {
  it("recognises links", () => {
    expect(isRemoteUrl("https://youtu.be/abc")).toBe(true);
    expect(isRemoteUrl("  http://example.com/v.mp4 ")).toBe(true);
  });

  it("treats everything else as a local path", () => {
    expect(isRemoteUrl("./output/match.mp4")).toBe(false);
    expect(isRemoteUrl("/home/me/video.mp4")).toBe(false);
    expect(isRemoteUrl("C:\\videos\\match.mp4")).toBe(false);
  });
});

describe("parseVtt", () => {
  it("reads plain cues", () => {
    const vtt = [
      "WEBVTT",
      "",
      "00:00:01.000 --> 00:00:03.500",
      "Hello there",
      "",
      "00:00:04.000 --> 00:00:06.000",
      "Second line",
    ].join("\n");
    const segments = parseVtt(vtt);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toEqual({ start: 1, end: 3.5, text: "Hello there" });
    expect(segments[1]!.start).toBe(4);
  });

  it("strips YouTube's inline karaoke markup", () => {
    const vtt = [
      "WEBVTT",
      "",
      "00:00:01.000 --> 00:00:03.000",
      "the <00:00:01.500><c>ball</c> is <00:00:02.100><c>in</c>",
    ].join("\n");
    expect(parseVtt(vtt)[0]!.text).toBe("the ball is in");
  });

  it("de-duplicates rolling cues instead of repeating every line", () => {
    // This is how auto-captions actually arrive: each cue repeats the previous
    // one so the caption appears to scroll.
    const vtt = [
      "WEBVTT",
      "",
      "00:00:01.000 --> 00:00:02.000",
      "he picks it up",
      "",
      "00:00:02.000 --> 00:00:03.000",
      "he picks it up",
      "",
      "00:00:03.000 --> 00:00:04.000",
      "he picks it up and drives forward",
    ].join("\n");
    const segments = parseVtt(vtt);
    expect(segments).toHaveLength(2);
    expect(segments[0]!.text).toBe("he picks it up");
    expect(segments[1]!.text).toBe("and drives forward");
  });

  it("de-duplicates a scrolling two-line caption box (the real YouTube shape)", () => {
    // The box holds two lines: a line appears as the BOTTOM line of one cue and
    // again as the TOP line of the next. Comparing whole cues misses this.
    const vtt = [
      "WEBVTT",
      "",
      "00:00:01.000 --> 00:00:02.000",
      "Don't be speaking in tongues and you're",
      "",
      "00:00:02.000 --> 00:00:03.000",
      "Don't be speaking in tongues and you're",
      "doing Instagram.",
      "",
      "00:00:03.000 --> 00:00:04.000",
      "doing Instagram.",
      "",
      "00:00:04.000 --> 00:00:05.000",
      "doing Instagram.",
      "That is not prayer.",
    ].join("\n");
    const text = parseVtt(vtt)
      .map((segment) => segment.text)
      .join(" ");
    expect(text).toBe("Don't be speaking in tongues and you're doing Instagram. That is not prayer.");
    expect(text.match(/doing Instagram/gu)).toHaveLength(1);
  });

  it("keeps a line that genuinely repeats later in the video", () => {
    const vtt = [
      "WEBVTT",
      "",
      "00:00:01.000 --> 00:00:02.000",
      "pray without ceasing",
      "",
      "00:05:00.000 --> 00:05:01.000",
      "and many other things happened here to push it out of the window entirely",
      "",
      "00:10:00.000 --> 00:10:01.000",
      "pray without ceasing",
    ].join("\n");
    const segments = parseVtt(vtt);
    expect(segments.filter((segment) => segment.text.includes("pray without ceasing"))).toHaveLength(2);
  });

  it("decodes HTML entities", () => {
    const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nrock &amp; roll &#39;n&#39; stuff";
    expect(parseVtt(vtt)[0]!.text).toBe("rock & roll 'n' stuff");
  });

  it("skips malformed and empty cues without throwing", () => {
    const vtt = [
      "WEBVTT",
      "",
      "not a timing line",
      "orphan text",
      "",
      "00:00:05.000 --> 00:00:04.000", // end before start
      "backwards",
      "",
      "00:00:08.000 --> 00:00:09.000",
      "",
      "",
      "00:00:10.000 --> 00:00:11.000",
      "good one",
    ].join("\n");
    const segments = parseVtt(vtt);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.text).toBe("good one");
  });

  it("handles comma decimal separators", () => {
    const vtt = "WEBVTT\n\n00:00:01,250 --> 00:00:02,750\nok";
    expect(parseVtt(vtt)[0]!.start).toBeCloseTo(1.25);
  });

  it("returns an empty list for junk input", () => {
    expect(parseVtt("")).toEqual([]);
    expect(parseVtt("not a vtt file at all")).toEqual([]);
  });
});
