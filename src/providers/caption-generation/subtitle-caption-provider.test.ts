import { describe, it, expect } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SubtitleCaptionProvider } from "./subtitle-caption-provider.js";
import type { CaptionContext } from "./types.js";
import type { GeneratedVoiceover } from "../voice-generation/index.js";

function voiceover(text: string, seconds: number): GeneratedVoiceover {
  return {
    segments: [
      {
        segmentId: "seg-1",
        text,
        audioPath: "seg-1.mp3",
        format: "mp3",
        voice: "onyx",
        plannedStartSecond: 0,
        plannedEndSecond: seconds,
        actualStartSecond: 0,
        actualEndSecond: seconds,
        actualDurationSeconds: seconds,
        characterCount: text.length,
      },
    ],
    totalDurationSeconds: seconds,
    outputDir: ".",
    warnings: [],
    metadata: {
      provider: "test",
      model: "test",
      voice: "onyx",
      format: "mp3",
      segmentCount: 1,
      totalCharacters: text.length,
      latencyMs: 0,
    },
  };
}

async function makeProvider(overrides: Partial<CaptionContext>): Promise<SubtitleCaptionProvider> {
  const dir = await mkdtemp(join(tmpdir(), "captions-test-"));
  return new SubtitleCaptionProvider({
    outputDir: dir,
    width: 1080,
    height: 1920,
    fontName: "Arial",
    accentColor: "#E63946",
    position: "bottom",
    karaoke: false,
    ...overrides,
  });
}

describe("SubtitleCaptionProvider", () => {
  it("makes exactly ONE cue per segment spanning its measured window", async () => {
    const provider = await makeProvider({});
    const result = await provider.generate({
      voiceover: voiceover("The house was empty and the lights were on.", 10),
    });

    // One segment → one cue → perfectly aligned to that segment's real audio.
    expect(result.cues.length).toBe(1);
    expect(result.cues[0]?.text).toBe("The house was empty and the lights were on.");
    expect(result.cues[0]?.startSecond).toBe(0);
    expect(result.cues[0]?.endSecond).toBe(10);
  });

  it("times each segment's cue to that segment's exact window", async () => {
    const provider = await makeProvider({});
    const vo = voiceover("First scene.", 4);
    const result = await provider.generate({
      voiceover: {
        ...vo,
        segments: [
          { ...vo.segments[0]!, segmentId: "seg-1", text: "First scene.", actualStartSecond: 0, actualEndSecond: 4, actualDurationSeconds: 4 },
          { ...vo.segments[0]!, segmentId: "seg-2", text: "Second scene.", actualStartSecond: 4, actualEndSecond: 9, actualDurationSeconds: 5 },
        ],
        totalDurationSeconds: 9,
      },
    });

    expect(result.cues.length).toBe(2);
    expect(result.cues[0]?.startSecond).toBe(0);
    expect(result.cues[0]?.endSecond).toBe(4);
    expect(result.cues[1]?.startSecond).toBe(4);
    expect(result.cues[1]?.endSecond).toBe(9);
  });

  it("karaoke mode adds \\k word timing to the ASS but keeps the SRT plain", async () => {
    const provider = await makeProvider({ karaoke: true });
    const result = await provider.generate({
      voiceover: voiceover("They told me the old house was empty.", 6),
    });

    const ass = await readFile(result.assPath, "utf8");
    const srt = await readFile(result.srtPath, "utf8");
    expect(ass).toContain("{\\k");
    expect(srt).not.toContain("{\\k");
    // Karaoke primary colour = the accent (#E63946 → ASS BGR 4639E6).
    expect(ass).toContain("&H004639E6");
  });

  it("karaoke word durations fill the whole cue window", async () => {
    const provider = await makeProvider({ karaoke: true });
    const result = await provider.generate({ voiceover: voiceover("One two three four.", 4) });

    const ass = await readFile(result.assPath, "utf8");
    const durations = [...ass.matchAll(/\{\\k(\d+)\}/gu)].map((m) => Number(m[1]));
    const total = durations.reduce((sum, cs) => sum + cs, 0);
    expect(total).toBe(400); // 4 seconds = 400 centiseconds
  });

  it("non-karaoke ASS uses plain white text (no \\k tags)", async () => {
    const provider = await makeProvider({ karaoke: false });
    const result = await provider.generate({ voiceover: voiceover("A calm sentence.", 3) });

    const ass = await readFile(result.assPath, "utf8");
    expect(ass).not.toContain("{\\k");
  });
});
