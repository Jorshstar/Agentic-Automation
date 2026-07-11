import { schedules } from "@trigger.dev/sdk";
import type { VideoPackage } from "../../types/index.js";
import { getNicheConfig } from "../../config/niches.js";
import { runStudio } from "../../studio/run-studio.js";
import type { StudioResult } from "../../studio/run-studio.js";
import { buildUploadCaption } from "../../studio/upload-caption.js";
import { StudioStageError } from "../../studio/run-ledger.js";
import { TelegramDeliveryProvider } from "../../providers/delivery/index.js";
import { logger } from "../../lib/logger.js";


/**
 * Daily content run — the scheduled automation.
 *
 * Every day it works out today's date, picks the niche from the rotation, and
 * runs the WHOLE studio pipeline (topic → research → narration → scene images →
 * voice → captions → music → composition → QA → export) via {@link runStudio}.
 *
 * It is a `schedules.task`, so Trigger.dev runs it automatically on the cron once
 * the project is deployed. You can also trigger it manually from the dashboard's
 * Test tab. Requires ANTHROPIC_API_KEY + OPENAI_API_KEY in the environment, and
 * ffmpeg — installed in the deploy via the ffmpeg build extension (trigger.config).
 */
export const generateDailyVideo = schedules.task({
  id: "generate-daily-video",

  // FFmpeg video encoding needs real RAM — the default (~0.5 GB) OOM-kills the
  // run at composition. medium-2x (4 GB) + the `-threads 2` cap in the composition
  // provider (which stops x264 spawning one thread per HOST core) keeps it safe.
  machine: "medium-2x",

  // Every day at 08:00 Nigeria time (Africa/Lagos, WAT). The timezone is explicit
  // so the post time is correct regardless of where the worker runs.
  cron: {
    pattern: "0 8 * * *",
    timezone: "Africa/Lagos",
  },

  run: async (payload, { ctx }): Promise<VideoPackage> => {
    const isoDate = payload.timestamp.toISOString().slice(0, 10);
    // SCARY ONLY. The rotation across niches was retired — the daily video is
    // always a true-history scary short (research picks the event, fact-checks it,
    // dark AI horror visuals). The other niches are made on demand, not daily.
    const niche = "scary-stories" as const;
    const nicheConfig = getNicheConfig(niche);

    logger.info("Daily content run started", {
      date: isoDate,
      niche: nicheConfig.label,
      style: nicheConfig.description,
      // Diagnostic: the machine this run ACTUALLY got (verifies the preset applied).
      machine: ctx.machine,
    });

    const telegram = new TelegramDeliveryProvider();

    // Run the full pipeline for today's niche (auto topic). Progress goes to the
    // Trigger.dev run log so you can watch each stage in the dashboard. A stage
    // failure ALERTS Telegram (with the runId to resume) instead of dying silently.
    let result: StudioResult;
    try {
      result = await runStudio({
        niche,
        onStep: (message) => logger.info(message),
      });
    } catch (error) {
      const detail =
        error instanceof StudioStageError
          ? `stage "${error.stage}" of run ${error.runId}\n${error.message}\n\nResume: npm run demo:studio -- --resume ${error.runId}`
          : error instanceof Error
            ? error.message
            : String(error);
      await telegram.notify(`❌ Daily video run FAILED (${nicheConfig.label}, ${isoDate})\n${detail}`);
      throw error; // let Trigger.dev record the failure + retry policy
    }

    logger.info("Daily content run finished", {
      date: isoDate,
      niche: nicheConfig.label,
      runId: result.runId,
      title: result.topic.title,
      durationSeconds: result.durationSeconds,
      scenes: result.segmentCount,
      qa: result.qa.status,
      costUsd: result.costUsd,
      videoPath: result.videoPath,
      finalDir: result.finalDir,
    });

    // QA GATE: a failed render is never delivered — alert instead, with the
    // failing checks so you can see why, and the runId to inspect/resume.
    if (!result.qa.passed) {
      const failed = result.qa.checks
        .filter((c) => c.status === "fail")
        .map((c) => `• ${c.label}: ${c.detail}`)
        .join("\n");
      await telegram.notify(
        `🚫 QA BLOCKED today's video (${nicheConfig.label}, ${isoDate})\n` +
          `"${result.topic.title}" — run ${result.runId}\n${failed}\n\n` +
          `The files are in ${result.finalDir} for inspection; nothing was delivered.`,
      );
      return { date: isoDate, niche, title: result.topic.title };
    }

    // Deliver the finished MP4 to Telegram (+ the upload kit, covers, manifest).
    // Graceful: if the bot isn't configured, it logs a warning instead of failing.
    const delivery = await telegram.deliver({
      videoPath: result.videoPath,
      caption: buildUploadCaption(result),
      documents: [
        result.uploadKitPath,
        result.thumbnailPath,
        result.wideThumbnailPath,
        result.manifestPath,
      ].filter((path) => path !== ""),
    });
    logger.info("Delivery", {
      delivered: delivery.delivered,
      videoSent: delivery.videoSent,
      documentsSent: delivery.documentsSent,
      warnings: delivery.warnings.map((w) => `${w.code}: ${w.message}`),
    });

    const videoPackage: VideoPackage = {
      date: isoDate,
      niche,
      title: result.topic.title,
      videoUrl: result.videoPath,
    };
    return videoPackage;
  },
});
