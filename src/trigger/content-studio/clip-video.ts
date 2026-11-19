import { task } from "@trigger.dev/sdk";
import { join } from "node:path";
import { TelegramClient } from "../../telegram/telegram-client.js";
import { runClipJob } from "../../clip/run-clip-job.js";
import type { CaptionPresetName } from "../../clip/captions.js";
import type { ReframeMode } from "../../clip/reframe.js";
import { logger } from "../../lib/logger.js";

/**
 * CLIP-VIDEO — the auto-clipper, as a cloud task.
 *
 * Given a long video (a link, or a file already on the machine) and a theme
 * ("the goals", "funny moments", "emotional bits"), it finds the moments that
 * match, renders each as a vertical captioned clip, and sends them to Telegram.
 *
 * The pipeline itself lives in `runClipJob` so this task and the local clip
 * worker run byte-identical logic — the two used to carry separate copies, which
 * is how they drifted apart. This file now owns only what is genuinely
 * task-specific: payload validation, the run directory, and user-facing
 * messaging.
 *
 * Needs yt-dlp + ffmpeg (both in the deploy image) and OPENAI + ANTHROPIC keys.
 */
export const clipVideo = task({
  id: "clip-video",
  machine: "large-1x",
  run: async (payload: ClipVideoPayload, { ctx }): Promise<ClipVideoResult> => {
    const telegram = new TelegramClient();
    const url = (payload.url ?? "").trim();
    const theme = (payload.theme ?? "auto").trim() || "auto";
    const count = Math.min(Math.max(payload.count ?? 5, 1), 8);

    if (url === "") {
      await telegram.send("⚠️ No video found. Paste a link, or upload a video, and tell me what to clip.");
      return { clips: 0, found: 0 };
    }

    const workDir = join("output", "clips", ctx.run.id);

    try {
      const result = await runClipJob(
        { url, theme, count, reframe: payload.reframe, captionPreset: payload.captionPreset },
        {
          workDir,
          // Progress goes straight to the chat so a long job never looks stalled.
          onStep: (message) => {
            void telegram.send(message);
          },
        },
      );

      await telegram.send(
        result.delivered > 0
          ? `✅ Sent ${result.delivered} clip(s) from "${result.title.slice(0, 70)}". Want more, or a different angle?`
          : "❌ I found moments but couldn't deliver them. Check the logs.",
      );

      logger.info("clip-video done", {
        url,
        theme,
        found: result.found,
        delivered: result.delivered,
        transcribedMinutes: result.transcribedMinutes,
      });
      return { clips: result.delivered, found: result.found };
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 300) : String(error);
      // yt-dlp's own stderr is the useful part here — it names the real reason
      // (private, age-restricted, region-locked, bot check) rather than a stack.
      await telegram.send(
        `❌ Clip job failed.\n${message}\n\n` +
          "If it's a link, it may be private, age-restricted, or region-locked — try another.",
      );
      logger.error("clip-video failed", { url, theme, error: message });
      throw error;
    }
  },
});

export interface ClipVideoPayload {
  /** A video link (anything yt-dlp handles) OR a path to a file on the machine. */
  readonly url?: string;
  /** What to clip: "the goals", "funny moments", "emotional", "key insights", "auto". */
  readonly theme?: string;
  /** Max clips to produce (1-8). */
  readonly count?: number;
  /**
   * How to lay out the vertical frame: a mode name ("smart", "wide", "fit",
   * "fit-top") or the user's own words ("show the whole video").
   */
  readonly reframe?: ReframeMode | string;
  /** Override the caption style the theme would choose. */
  readonly captionPreset?: CaptionPresetName;
}

export interface ClipVideoResult {
  /** Clips actually delivered. */
  readonly clips: number;
  /** Moments selected before rendering and QA. */
  readonly found: number;
}
