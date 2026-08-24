import { task } from "@trigger.dev/sdk";
import { join } from "node:path";
import { TelegramClient } from "../../telegram/telegram-client.js";
import { TelegramDeliveryProvider } from "../../providers/delivery/index.js";
import { downloadSource } from "../../clip/source-download.js";
import { transcribe } from "../../clip/transcribe.js";
import type { TranscriptWord } from "../../clip/transcribe.js";
import { energyPeaks } from "../../clip/audio-energy.js";
import { ClaudeMomentSelectionProvider, removeOverlaps } from "../../clip/select-moments.js";
import type { ClipMoment } from "../../clip/select-moments.js";
import { renderClip } from "../../clip/render-clip.js";
import { logger } from "../../lib/logger.js";

/**
 * CLIP-VIDEO — the auto-clipper. Given a long video URL and a theme, it downloads
 * the source, transcribes it (word timestamps), scans loudness, asks Claude to
 * pick the best theme-matching moments, renders each as a vertical captioned
 * clip, and delivers them to Telegram.
 *
 * Needs yt-dlp + ffmpeg (both in the deploy image) and OPENAI + ANTHROPIC keys.
 */
export const clipVideo = task({
  id: "clip-video",
  machine: "large-1x",
  run: async (payload: ClipVideoPayload, { ctx }): Promise<{ clips: number }> => {
    const telegram = new TelegramClient();
    const url = (payload.url ?? "").trim();
    const theme = (payload.theme ?? "auto").trim() || "auto";
    const count = Math.min(Math.max(payload.count ?? 5, 1), 8);

    if (url === "") {
      await telegram.send("⚠️ No video link found. Paste a YouTube link and tell me what to clip.");
      return { clips: 0 };
    }

    const workDir = join("output", "clips", ctx.run.id);

    // 1) Download the source.
    await telegram.send(`⛏ Grabbing the video…`);
    let source;
    try {
      source = await downloadSource(url, workDir);
    } catch (error) {
      await telegram.send(
        `❌ Couldn't download that video.\n${error instanceof Error ? error.message.slice(0, 300) : String(error)}\n\n` +
          `It may be private, age-restricted, or region-locked. Try another link.`,
      );
      throw error;
    }

    // 2) Transcribe + 3) scan loudness (independent — run together).
    await telegram.send(`📝 Transcribing "${source.title.slice(0, 80)}" (${Math.round(source.durationSeconds / 60)} min)…`);
    const [transcript, peaks] = await Promise.all([
      transcribe(source.videoPath, join(workDir, "audio")),
      energyPeaks(source.videoPath),
    ]);
    if (transcript.words.length === 0) {
      await telegram.send("❌ I couldn't get any speech out of that video, so I can't find moments to clip.");
      return { clips: 0 };
    }

    // 4) Select moments (theme-driven).
    await telegram.send(`🎯 Finding the best ${theme === "auto" ? "" : `"${theme}" `}moments…`);
    const selector = new ClaudeMomentSelectionProvider();
    const moments = await selector.select({
      theme,
      count,
      title: source.title,
      description: source.description,
      durationSeconds: source.durationSeconds,
      segments: transcript.segments,
      peaks,
      chapters: source.chapters,
    });
    const snapped = removeOverlaps(
      moments
        .map((m) => snapToWords(m, transcript.words))
        .filter((m) => m.endSecond - m.startSecond >= 10),
    );

    if (snapped.length === 0) {
      await telegram.send(
        `🤔 I couldn't find strong ${theme === "auto" ? "" : `"${theme}" `}moments in that one. Try a different theme or video.`,
      );
      return { clips: 0 };
    }

    await telegram.send(`✂️ Cutting ${snapped.length} clip(s)…`);

    // 5) Render + 6) deliver each clip.
    const delivery = new TelegramDeliveryProvider();
    let delivered = 0;
    for (const [i, moment] of snapped.entries()) {
      const outPath = join(workDir, `clip-${i + 1}.mp4`);
      const assPath = join(workDir, `clip-${i + 1}.ass`);
      const render = await renderClip({
        sourcePath: source.videoPath,
        startSecond: moment.startSecond,
        endSecond: moment.endSecond,
        words: transcript.words,
        outPath,
        assPath,
      });
      if (!render.ok) {
        logger.error("clip render failed", { clip: i + 1, stderr: render.stderr.slice(0, 300) });
        continue;
      }
      const result = await delivery.deliver({
        videoPath: outPath,
        caption: `🎬 ${moment.hook}\n\nClipped from "${source.title.slice(0, 90)}"`,
        documents: [],
      });
      if (result.videoSent) delivered++;
    }

    await telegram.send(
      delivered > 0
        ? `✅ Sent ${delivered} clip(s). Want a different angle or more?`
        : `❌ I found moments but couldn't render them. Check the logs.`,
    );
    logger.info("clip-video done", { url, theme, found: snapped.length, delivered, minutes: transcript.minutes });
    return { clips: delivered };
  },
});

/** Snap a moment's edges to the nearest word boundaries so no word is cut mid-way. */
function snapToWords(moment: ClipMoment, words: readonly TranscriptWord[]): ClipMoment {
  if (words.length === 0) return moment;
  const startWord = words.find((w) => w.start >= moment.startSecond - 0.3) ?? words[0]!;
  const before = words.filter((w) => w.end <= moment.endSecond + 0.3);
  const endWord = before.length > 0 ? before[before.length - 1]! : startWord;
  let start = startWord.start;
  let end = Math.max(endWord.end, start + 10);
  if (end - start > 75) end = start + 75; // hard cap so a clip never runs long
  return { ...moment, startSecond: start, endSecond: end };
}

export interface ClipVideoPayload {
  readonly url?: string;
  /** What to clip: "goals", "funny", "key insights", or "auto". */
  readonly theme?: string;
  /** Max clips to produce (1-8). */
  readonly count?: number;
}
