/**
 * Music demo — production stage 4 (ambient bed).
 *
 * For each niche, synthesizes a short ambient sample with FFmpeg in that niche's
 * mood, so you can hear the difference (tense drone vs. upbeat vs. warm vs.
 * emotive). Fully local — no AI, no network, no key. FFmpeg must be on PATH.
 *
 *   npm run demo:music
 */
import { FfmpegMusicProvider } from "../providers/music-generation/index.js";
import { NICHE_PROFILES } from "../config/niche-profiles.js";
import { buildMusicGenerationContext } from "../config/niche-context.js";
import { isFfprobeAvailable } from "../lib/media.js";
import type { PresetNiche } from "../types/index.js";
import { logger } from "../lib/logger.js";

const SAMPLE_SECONDS = 8;

async function main(): Promise<void> {
  if (!(await isFfprobeAvailable())) {
    logger.warn("Skipping music demo — ffmpeg/ffprobe not found on PATH.");
    return;
  }

  console.log(`\nSynthesizing a ${SAMPLE_SECONDS}s ambient sample per niche...\n`);

  for (const niche of Object.keys(NICHE_PROFILES) as PresetNiche[]) {
    const profile = NICHE_PROFILES[niche];
    const context = buildMusicGenerationContext(profile);
    const provider = new FfmpegMusicProvider({
      ...context,
      outputDir: `output/music/samples/${niche}`,
    });

    const music = await provider.generate({ durationSeconds: SAMPLE_SECONDS });

    const v = music.metadata.variation;
    console.log(
      `${profile.label.padEnd(22)} mood=${music.mood}  variation: ${v.semitones >= 0 ? "+" : ""}${v.semitones} semitones, tremolo ×${v.tremoloFactor} (seed ${v.seed})`,
    );
    if (music.musicPath !== "") {
      console.log(`  🔊 ${music.musicPath}  (${music.durationSeconds}s, ${(music.bytes / 1024).toFixed(0)} KB)`);
    }
    for (const warning of music.warnings) {
      console.log(`  ! [${warning.code}] ${warning.message}`);
    }
  }

  console.log(`\nDone. Play the files under output/music/samples/<niche>/ to compare moods.`);
}

main().catch((error: unknown) => {
  logger.error("Music demo failed", { error: String(error) });
  process.exitCode = 1;
});
