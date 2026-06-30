import { schedules } from "@trigger.dev/sdk";
import type { VideoPackage } from "../../types/index.js";
import { getNicheConfig } from "../../config/niches.js";
import { getNicheForDate } from "../../lib/niche-rotation.js";
import { logger } from "../../lib/logger.js";

/**
 * Daily content run (FOUNDATION SKELETON).
 *
 * Right now this task only does the *planning* part: it works out today's date,
 * picks the correct niche from the rotation, and logs what it WOULD build. The
 * heavy lifting (AI script, voiceover, video render, storage, Telegram) is added
 * in later steps — see the TODO block below.
 *
 * It is a `schedules.task`, so Trigger.dev runs it automatically on the cron
 * below once the project is deployed. You can also trigger it manually from the
 * dashboard's Test tab while developing.
 */
export const generateDailyVideo = schedules.task({
  id: "generate-daily-video",

  // ┌ minute (0)
  // │ ┌ hour (9 → 09:00)
  // │ │ ┌ day-of-month (any)
  // │ │ │ ┌ month (any)
  // │ │ │ │ ┌ day-of-week (any)
  // 0 9 * * *  → every day at 09:00 (UTC by default). Change to adjust timing.
  cron: "0 9 * * *",

  run: async (payload): Promise<VideoPackage> => {
    // `payload.timestamp` is the scheduled run time as a Date.
    // Slice the ISO string to get a clean YYYY-MM-DD calendar day.
    const isoDate = payload.timestamp.toISOString().slice(0, 10);

    const niche = getNicheForDate(isoDate);
    const nicheConfig = getNicheConfig(niche);

    logger.info("Daily content run started", {
      date: isoDate,
      niche: nicheConfig.label,
      style: nicheConfig.description,
    });

    // ─── FUTURE STEPS (intentionally NOT implemented in the foundation) ───────
    // 1. Generate a 60-second script with an AI model, tailored to `niche`.
    // 2. Produce a voiceover and render a vertical (9:16) 60s video.
    // 3. Save the finished package to local / Google Drive / cloud storage.
    // 4. Send a Telegram notification with the package details + links.
    // ──────────────────────────────────────────────────────────────────────────

    // For now we return a minimal package describing only what was planned.
    const videoPackage: VideoPackage = {
      date: isoDate,
      niche,
    };

    logger.info("Daily content run finished (foundation skeleton — no media produced yet)", {
      date: isoDate,
      niche: nicheConfig.label,
    });

    return videoPackage;
  },
});
