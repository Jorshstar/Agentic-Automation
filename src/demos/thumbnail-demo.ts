/**
 * Thumbnail demo — cover images (vertical + wide) from an existing scene image.
 *
 * Takes the scary hook-scene image already on disk (from an earlier run), burns
 * bold niche-styled cover text onto it with FFmpeg/libass, and writes:
 *   output/thumbnails/demo/thumbnail.jpg        (1080x1920)
 *   output/thumbnails/demo/thumbnail-wide.jpg   (1280x720)
 *
 * Fully local — no AI, no network, no cost. FFmpeg must be on PATH.
 *
 *   npm run demo:thumbnail
 */
import { access } from "node:fs/promises";
import { FfmpegThumbnailProvider } from "../providers/thumbnail-generation/index.js";
import { getNicheProfile } from "../config/niche-profiles.js";
import { buildThumbnailContext } from "../config/niche-context.js";
import { isFfprobeAvailable } from "../lib/media.js";
import { logger } from "../lib/logger.js";

/** Candidate source images from earlier runs (first existing one wins). */
const CANDIDATES = [
  "output/assets/images/scary-stories/seg-1.png",
  "output/assets/images/seg-1.png",
];

async function firstExisting(paths: readonly string[]): Promise<string | undefined> {
  for (const path of paths) {
    try {
      await access(path);
      return path;
    } catch {
      // keep looking
    }
  }
  return undefined;
}

async function main(): Promise<void> {
  if (!(await isFfprobeAvailable())) {
    logger.warn("Skipping thumbnail demo — ffmpeg not found on PATH.");
    return;
  }

  const imagePath = await firstExisting(CANDIDATES);
  if (!imagePath) {
    logger.warn("No scene image found — run `npm run demo:image-generation` or `demo:studio` first.");
    return;
  }

  const profile = getNicheProfile("scary-stories");
  const provider = new FfmpegThumbnailProvider({
    ...buildThumbnailContext(profile),
    outputDir: "output/thumbnails/demo",
  });

  const result = await provider.generate({
    imagePath,
    text: "P4 SHOULDN'T EXIST",
  });

  console.log("\n=== FfmpegThumbnailProvider ===");
  console.log("Provider:", provider.name);
  console.log(`Source:   ${result.metadata.sourceImage}`);
  console.log(`Text:     "${result.text}"  (accent ${profile.captionAccent})`);
  console.log(`Vertical: ${result.thumbnailPath || "(failed)"}`);
  console.log(`Wide:     ${result.wideThumbnailPath || "(failed)"}`);
  console.log(`Took:     ${result.metadata.latencyMs} ms`);

  console.log("\n--- Warnings ---");
  if (result.warnings.length === 0) {
    console.log(" (none)");
  } else {
    for (const warning of result.warnings) {
      console.log(` ! [${warning.code}] ${warning.message}`);
    }
  }
}

main().catch((error: unknown) => {
  logger.error("Thumbnail demo failed", { error: String(error) });
  process.exitCode = 1;
});
