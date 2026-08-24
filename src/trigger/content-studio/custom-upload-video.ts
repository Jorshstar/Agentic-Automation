import { task } from "@trigger.dev/sdk";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { TelegramClient } from "../../telegram/telegram-client.js";
import { TelegramDeliveryProvider } from "../../providers/delivery/index.js";
import { resolveBrief, runResolvedBrief } from "../../studio/content-brief.js";
import { buildUploadCaption } from "../../studio/upload-caption.js";
import { StudioStageError } from "../../studio/run-ledger.js";
import { logger } from "../../lib/logger.js";

/**
 * CUSTOM UPLOAD VIDEO — builds a video from the assets you send the bot.
 *
 * Triggered by {@link telegramIngest} once you've uploaded photos/videos and said
 * "go". The payload carries the Telegram file_ids (not the bytes) plus your brief;
 * this task downloads each file itself (the bot can fetch files up to 20 MB),
 * places your media on the first scenes IN ORDER, lets the AI fill the remaining
 * scenes + expand your brief into a script, then composes + delivers to Telegram.
 *
 * Same machine + ffmpeg as the daily job (see trigger.config ffmpeg extension).
 */
export const customUploadVideo = task({
  id: "custom-upload-video",
  machine: "large-1x",
  run: async (payload: CustomUploadPayload, { ctx }): Promise<{ runId?: string; delivered: boolean }> => {
    const brief = (payload.brief ?? "").trim();
    const assets = payload.assets ?? [];
    const telegram = new TelegramClient();

    // A video can be built from words alone — attachments are optional. Only bail
    // if there's genuinely nothing to work from.
    if (brief === "" && assets.length === 0) {
      await telegram.send("⚠️ I didn't catch what to make — tell me the idea and I'll build it.");
      return { delivered: false };
    }

    // 1) Download any attached files to this run's workspace. Oversize (>20 MB)
    //    or failed downloads are skipped with a note rather than killing the run —
    //    the AI fills those scenes instead.
    const workDir = join("output", "uploads", ctx.run.id);
    await mkdir(workDir, { recursive: true });
    const userAssets: { path: string; kind: "photo" | "video" }[] = [];
    const skipped: string[] = [];
    for (const [i, asset] of assets.entries()) {
      const ext = asset.kind === "video" ? "mp4" : "jpg";
      const dest = join(workDir, `asset-${i + 1}.${ext}`);
      const result = await telegram.download(asset.fileId, dest);
      if (result.ok) {
        userAssets.push({ path: dest, kind: asset.kind });
      } else {
        skipped.push(`${asset.kind} #${i + 1}: ${result.error}`);
      }
    }
    if (skipped.length > 0) {
      logger.warn("Some uploads were skipped", { skipped });
    }

    // 2) Resolve an identity from the brief (AI designs a one-off look/voice), and
    //    force AI-fill (no stock) so gaps match the "photos + AI fills" choice.
    const resolved = await resolveBrief({
      instructions: brief !== "" ? brief : "A short, engaging vertical video built around these images.",
      durationSeconds: 60,
    });

    // VOICE SPEED — pin it. The identity designer picks pacing/voice-style per
    // brief, so uploads came out inconsistently slow (calm, pause-heavy reads).
    // Force a steady, lively delivery every time so an uploaded video always has
    // the same energetic pace as the daily video — never draggy.
    const briskProfile = {
      ...resolved.profile,
      pacing: "medium" as const,
      voiceInstructions:
        "Natural, confident, well-paced delivery with steady energy. Keep it moving — no long pauses, do not drag or slow down.",
    };
    const resolvedNoStock = {
      ...resolved,
      profile: briskProfile,
      run: { ...resolved.run, useStockVideo: false },
    };

    // 3) Run the full pipeline with the user's media placed first.
    let result;
    try {
      result = await runResolvedBrief(resolvedNoStock, {
        userAssets,
        onStep: (message) => logger.info(message),
      });
    } catch (error) {
      const detail =
        error instanceof StudioStageError
          ? `stage "${error.stage}" of ${error.runId}\n${error.message}\nResume: npm run studio:resume -- ${error.runId}`
          : error instanceof Error
            ? error.message
            : String(error);
      await telegram.send(`❌ Your custom video FAILED\n${detail}`);
      throw error;
    }

    // 4) QA gate — a failed render is never delivered.
    if (!result.qa.passed) {
      const failed = result.qa.checks
        .filter((c) => c.status === "fail")
        .map((c) => `• ${c.label}: ${c.detail}`)
        .join("\n");
      await telegram.send(
        `🚫 QA blocked your custom video "${result.topic.title}" — run ${result.runId}\n${failed}`,
      );
      return { runId: result.runId, delivered: false };
    }

    // 5) Deliver the finished MP4 (+ the upload kit) back to Telegram.
    const delivery = await new TelegramDeliveryProvider().deliver({
      videoPath: result.videoPath,
      caption: buildUploadCaption(result),
      documents: [result.uploadKitPath, result.thumbnailPath, result.manifestPath].filter((p) => p !== ""),
    });
    logger.info("Custom upload delivered", {
      runId: result.runId,
      delivered: delivery.delivered,
      videoSent: delivery.videoSent,
    });

    return { runId: result.runId, delivered: delivery.delivered };
  },
});

export interface CustomUploadPayload {
  /** The brief / instructions (from your text or the album caption). */
  readonly brief?: string;
  /** Uploaded files as Telegram file_ids — this task downloads them. */
  readonly assets?: readonly { readonly fileId: string; readonly kind: "photo" | "video" }[];
}
