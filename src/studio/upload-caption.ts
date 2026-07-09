import type { StudioResult } from "./run-studio.js";

/** Build the Telegram caption for a finished video: title, hook, stats, hashtags. */
export function buildUploadCaption(result: StudioResult): string {
  const hashtags = result.seo.tiktok.hashtags.join(" ");
  return (
    `🎬 ${result.seo.youtube.title}\n` +
    `${result.topic.hook}\n\n` +
    `${result.niche} · ${Math.round(result.durationSeconds)}s · QA: ${result.qa.status.toUpperCase()} · $${result.costUsd.toFixed(2)}\n` +
    (hashtags ? `\n${hashtags}` : "")
  );
}
