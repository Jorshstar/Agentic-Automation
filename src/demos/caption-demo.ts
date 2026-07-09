/**
 * Caption demo — production stage 2 (subtitles).
 *
 * Builds a sample MEASURED voiceover (as the Voice stage produces) and turns it
 * into a synced subtitle track (.srt + styled .ass) with the niche's caption
 * accent colour. Fully local — no AI, no network, no key.
 *
 *   VoiceGenerationResult (measured timeline) → CaptionGenerationProvider
 *     → captions.srt + captions.ass
 *
 *   npm run demo:captions
 */
import { readFile } from "node:fs/promises";
import { SubtitleCaptionProvider } from "../providers/caption-generation/index.js";
import type { GeneratedVoiceover } from "../providers/voice-generation/index.js";
import { getNicheProfile } from "../config/niche-profiles.js";
import { buildCaptionContext } from "../config/niche-context.js";
import { logger } from "../lib/logger.js";

/** A sample measured voiceover (scary-stories), as the Voice stage would emit. */
const SAMPLE_VOICEOVER: GeneratedVoiceover = {
  segments: [
    {
      segmentId: "seg-1",
      text: "They told me the old house was completely empty.",
      audioPath: "output/voice/seg-1.mp3",
      format: "mp3",
      voice: "onyx",
      plannedStartSecond: 0,
      plannedEndSecond: 6,
      actualStartSecond: 0,
      actualEndSecond: 4.2,
      actualDurationSeconds: 4.2,
      characterCount: 48,
    },
    {
      segmentId: "seg-2",
      text: "So tell me, who just turned off the lights upstairs?",
      audioPath: "output/voice/seg-2.mp3",
      format: "mp3",
      voice: "onyx",
      plannedStartSecond: 6,
      plannedEndSecond: 12,
      actualStartSecond: 4.2,
      actualEndSecond: 9.1,
      actualDurationSeconds: 4.9,
      characterCount: 52,
    },
    {
      segmentId: "seg-3",
      text: "I only asked once. The house, unfortunately, answered back.",
      audioPath: "output/voice/seg-3.mp3",
      format: "mp3",
      voice: "onyx",
      plannedStartSecond: 12,
      plannedEndSecond: 18,
      actualStartSecond: 9.1,
      actualEndSecond: 14.6,
      actualDurationSeconds: 5.5,
      characterCount: 58,
    },
  ],
  totalDurationSeconds: 14.6,
  outputDir: "output/voice",
  warnings: [],
  metadata: {
    provider: "openai",
    model: "gpt-4o-mini-tts",
    voice: "onyx",
    format: "mp3",
    segmentCount: 3,
    totalCharacters: 158,
    latencyMs: 0,
  },
};

async function main(): Promise<void> {
  const profile = getNicheProfile("scary-stories");
  const context = buildCaptionContext(profile);
  const provider = new SubtitleCaptionProvider(context);

  const captions = await provider.generate({ voiceover: SAMPLE_VOICEOVER });

  console.log("\n=== CaptionGenerationProvider (subtitles) ===");
  console.log("Provider:", provider.name);
  console.log(`Niche:    ${profile.label}  (accent ${profile.captionAccent})`);
  console.log(`Cues:     ${captions.metadata.cueCount} from ${captions.metadata.segmentCount} segments`);
  console.log(`Total:    ${captions.totalDurationSeconds}s`);

  console.log("\n--- Cues ---");
  for (const cue of captions.cues) {
    console.log(
      `  ${String(cue.index).padStart(2, " ")}. [${cue.startSecond.toFixed(2)}s–${cue.endSecond.toFixed(2)}s] (${cue.segmentId})  "${cue.text}"`,
    );
  }

  console.log("\n--- Files ---");
  console.log(`  SRT: ${captions.srtPath}`);
  console.log(`  ASS: ${captions.assPath}`);

  console.log("\n--- captions.srt (preview) ---");
  console.log((await readFile(captions.srtPath, "utf8")).split("\n").slice(0, 8).join("\n"));

  console.log("\n--- captions.ass (style line) ---");
  const assLines = (await readFile(captions.assPath, "utf8")).split("\n");
  const styleLine = assLines.find((line) => line.startsWith("Style:"));
  const firstEvent = assLines.find((line) => line.startsWith("Dialogue:"));
  console.log(`  ${styleLine ?? "(no style line)"}`);
  console.log(`  ${firstEvent ?? "(no events)"}`);

  console.log("\n--- Warnings ---");
  if (captions.warnings.length === 0) {
    console.log(" (none)");
  } else {
    for (const warning of captions.warnings) {
      console.log(` ! [${warning.code}]${warning.segmentId ? " " + warning.segmentId : ""}: ${warning.message}`);
    }
  }
}

main().catch((error: unknown) => {
  logger.error("Caption demo failed", { error: String(error) });
  process.exitCode = 1;
});
