/**
 * Composition demo — production stage 5: the first WATCHABLE MP4.
 *
 * A mini end-to-end for scary-stories. Reuses the 4 scary images already in
 * output/assets/images/ (free), synthesizes matching narration, builds captions
 * and a music bed, then composes everything into one vertical MP4:
 *
 *   voice + images + captions + music → FfmpegCompositionProvider → output/video/scary-stories.mp4
 *
 * Requires OPENAI_API_KEY (for the narration) and ffmpeg on PATH.
 *
 *   npm run demo:compose
 */
import { OpenAIVoiceGenerationProvider } from "../providers/voice-generation/index.js";
import { SubtitleCaptionProvider } from "../providers/caption-generation/index.js";
import { FfmpegMusicProvider } from "../providers/music-generation/index.js";
import { FfmpegCompositionProvider } from "../providers/composition/index.js";
import type { NarrativeScript } from "../providers/narrative/index.js";
import type { GeneratedImages } from "../providers/image-generation/index.js";
import { getNicheProfile } from "../config/niche-profiles.js";
import {
  buildVoiceGenerationContext,
  buildCaptionContext,
  buildMusicGenerationContext,
  buildCompositionContext,
} from "../config/niche-context.js";
import { isFfprobeAvailable } from "../lib/media.js";
import { logger } from "../lib/logger.js";

try {
  process.loadEnvFile();
} catch {
  // No .env — fall back to the ambient environment.
}

/** Narration matched to the 4 scary images (empty house → staircase → switch → figure). */
const LINES = [
  "They told me the old house was completely empty.",
  "But the staircase creaked, as if something was climbing it.",
  "A cold hand reached for the light switch. It wasn't mine.",
  "At the end of the hall, a figure stood, smiling in the dark.",
] as const;

function scaryNarrative(): NarrativeScript {
  return {
    hook: LINES[0],
    segments: LINES.map((text, i) => ({
      startSecond: i * 5,
      endSecond: i * 5 + 5,
      text,
      emotion: "ominous",
      visualHint: "",
    })),
    callToAction: "Follow for more.",
    estimatedDurationSeconds: LINES.length * 5,
    warnings: [],
    metadata: {
      promptId: "sample",
      promptVersion: "v1",
      provider: "sample",
      model: "sample",
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      latencyMs: 0,
    },
  };
}

/** Point at the already-generated scary images (no regeneration cost). */
function existingImages(): GeneratedImages {
  return {
    images: [1, 2, 3, 4].map((i) => ({
      segmentId: `seg-${i}`,
      prompt: "",
      imagePath: `output/assets/images/seg-${i}.png`,
      status: "generated" as const,
      model: "gpt-image-1",
      format: "png" as const,
      width: 1024,
      height: 1536,
      bytes: 0,
    })),
    outputDir: "output/assets/images",
    warnings: [],
    metadata: {
      provider: "openai",
      model: "gpt-image-1",
      size: "1024x1536",
      quality: "medium",
      requested: 4,
      generated: 4,
      totalBytes: 0,
      latencyMs: 0,
    },
  };
}

async function main(): Promise<void> {
  if (!(await isFfprobeAvailable())) {
    logger.warn("Skipping compose demo — ffmpeg/ffprobe not found on PATH.");
    return;
  }
  if (!process.env.OPENAI_API_KEY) {
    logger.warn("Skipping compose demo — set OPENAI_API_KEY (needed for narration).");
    return;
  }

  const profile = getNicheProfile("scary-stories");

  // 1. Narration (real TTS).
  console.log("1/4  Synthesizing narration...");
  const voiceProvider = new OpenAIVoiceGenerationProvider({
    ...buildVoiceGenerationContext(profile),
    outputDir: "output/voice/scary",
  });
  const voiceover = await voiceProvider.generate({ narrative: scaryNarrative() });
  console.log(`     ${voiceover.segments.length} clips, ${voiceover.totalDurationSeconds}s total.`);

  // 2. Captions from the measured timeline.
  console.log("2/4  Building captions...");
  const captionProvider = new SubtitleCaptionProvider(buildCaptionContext(profile));
  const captions = await captionProvider.generate({ voiceover });
  console.log(`     ${captions.metadata.cueCount} cues.`);

  // 3. Music bed sized to the narration.
  console.log("3/4  Synthesizing music bed...");
  const musicProvider = new FfmpegMusicProvider({
    ...buildMusicGenerationContext(profile),
    outputDir: "output/music/scary",
  });
  const music = await musicProvider.generate({ durationSeconds: voiceover.totalDurationSeconds });
  console.log(`     mood=${music.mood}, ${music.durationSeconds}s.`);

  // 4. Compose the MP4.
  console.log("4/4  Composing the video (FFmpeg)...");
  const composer = new FfmpegCompositionProvider(buildCompositionContext(profile));
  const video = await composer.compose({ voiceover, images: existingImages(), captions, music });

  console.log("\n=== FfmpegCompositionProvider ===");
  if (video.videoPath === "") {
    console.log("Render FAILED.");
  } else {
    console.log(`🎬 ${video.videoPath}`);
    console.log(`   ${video.width}x${video.height} @ ${video.fps}fps, ${video.durationSeconds}s, ${(video.metadata.sizeBytes / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   audio=${video.hasAudio}  captions=${video.hasCaptions}  music=${video.hasMusic}`);
    console.log(`   render time: ${(video.metadata.renderMs / 1000).toFixed(1)}s`);
  }

  console.log("\n--- Warnings ---");
  if (video.warnings.length === 0) {
    console.log(" (none)");
  } else {
    for (const warning of video.warnings) {
      console.log(` ! [${warning.code}]${warning.segmentId ? " " + warning.segmentId : ""}: ${warning.message}`);
    }
  }

  if (video.videoPath !== "") {
    console.log(`\nOpen ${video.videoPath} to watch your first faceless video.`);
  }
}

main().catch((error: unknown) => {
  logger.error("Compose demo failed", { error: String(error) });
  process.exitCode = 1;
});
