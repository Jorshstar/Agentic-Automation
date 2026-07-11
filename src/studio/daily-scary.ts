/**
 * Daily scary video — the LOCAL 8am job.
 *
 * Makes ONE true-history scary short with the CURRENT pipeline (research picks +
 * fact-checks a real eerie event, dark AI horror visuals, "Did you know..."
 * opening, natural pace) and delivers it to Telegram. Runs on THIS machine via
 * Windows Task Scheduler — the Trigger.dev cloud task OOMs at composition, so the
 * daily video is produced locally instead.
 *
 *   npm run studio:daily
 *
 * Needs ANTHROPIC_API_KEY, OPENAI_API_KEY, PEXELS/PIXABAY (optional), and the
 * Telegram bot vars. ffmpeg on PATH.
 */
import { runStudio } from "./run-studio.js";
import { StudioStageError } from "./run-ledger.js";
import { buildUploadCaption } from "./upload-caption.js";
import { TelegramDeliveryProvider } from "../providers/delivery/index.js";
import { isFfprobeAvailable } from "../lib/media.js";
import { logger } from "../lib/logger.js";

try {
  process.loadEnvFile();
} catch {
  // No .env — fall back to the ambient environment.
}

async function main(): Promise<void> {
  const isoDate = new Date().toISOString().slice(0, 10);
  const telegram = new TelegramDeliveryProvider();

  if (!(await isFfprobeAvailable())) {
    await telegram.notify("❌ Daily scary video skipped — ffmpeg not found on PATH.");
    return;
  }

  logger.info("Daily scary video started", { date: isoDate });

  let result;
  try {
    result = await runStudio({ niche: "scary-stories", onStep: (m) => logger.info(m) });
  } catch (error) {
    const detail =
      error instanceof StudioStageError
        ? `stage "${error.stage}" of ${error.runId}\nResume: npm run studio:resume -- ${error.runId}`
        : error instanceof Error
          ? error.message
          : String(error);
    await telegram.notify(`❌ Daily scary video FAILED (${isoDate})\n${detail}`);
    process.exitCode = 1;
    return;
  }

  // QA gate — a failed render is never delivered; you get an alert instead.
  if (!result.qa.passed) {
    await telegram.notify(
      `🚫 QA blocked today's scary video (${isoDate})\n"${result.topic.title}" — ${result.finalDir}`,
    );
    return;
  }

  const delivery = await new TelegramDeliveryProvider().deliver({
    videoPath: result.videoPath,
    caption: buildUploadCaption(result),
    documents: [result.uploadKitPath, result.thumbnailPath, result.wideThumbnailPath, result.manifestPath].filter((p) => p !== ""),
  });

  logger.info("Daily scary video delivered", {
    date: isoDate,
    title: result.topic.title,
    cost: result.costUsd,
    delivered: delivery.delivered,
  });
}

main().catch((error: unknown) => {
  logger.error("Daily scary video crashed", { error: String(error) });
  process.exitCode = 1;
});
