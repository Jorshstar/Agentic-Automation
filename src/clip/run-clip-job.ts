import { join } from "node:path";
import { downloadSource } from "./source-download.js";
import { transcribe } from "./transcribe.js";
import type { TranscriptWord } from "./transcribe.js";
import { energyPeaks } from "./audio-energy.js";
import { ClaudeMomentSelectionProvider, removeOverlaps } from "./select-moments.js";
import type { ClipMoment } from "./select-moments.js";
import { renderClip } from "./render-clip.js";
import { TelegramDeliveryProvider } from "../providers/delivery/index.js";

/**
 * The whole clip pipeline in one function, so the cloud task AND the local clip
 * worker run identical logic: download → transcribe + loudness → theme-driven
 * selection → de-overlap + snap to word boundaries → render vertical captioned
 * clips → deliver to Telegram.
 */

export interface ClipJob {
  readonly url: string;
  readonly theme: string;
  readonly count: number;
}

export interface ClipJobResult {
  readonly delivered: number;
  readonly found: number;
  readonly title: string;
}

export async function runClipJob(
  job: ClipJob,
  opts: { workDir: string; onStep?: (message: string) => void },
): Promise<ClipJobResult> {
  const log = opts.onStep ?? (() => {});
  const url = job.url.trim();
  const theme = (job.theme || "auto").trim() || "auto";
  const count = Math.min(Math.max(job.count || 5, 1), 8);

  log("⛏ Grabbing the video…");
  const source = await downloadSource(url, opts.workDir);

  log(`📝 Transcribing "${source.title.slice(0, 70)}" (${Math.round(source.durationSeconds / 60)} min)…`);
  const [transcript, peaks] = await Promise.all([
    transcribe(source.videoPath, join(opts.workDir, "audio")),
    energyPeaks(source.videoPath),
  ]);
  if (transcript.words.length === 0) {
    log("❌ No speech found in that video — nothing to clip.");
    return { delivered: 0, found: 0, title: source.title };
  }

  log(`🎯 Finding the best ${theme === "auto" ? "" : `"${theme}" `}moments…`);
  const moments = await new ClaudeMomentSelectionProvider().select({
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
    moments.map((m) => snapToWords(m, transcript.words)).filter((m) => m.endSecond - m.startSecond >= 10),
  );
  if (snapped.length === 0) {
    log(`🤔 No strong ${theme === "auto" ? "" : `"${theme}" `}moments found. Try a different theme or video.`);
    return { delivered: 0, found: 0, title: source.title };
  }

  log(`✂️ Cutting ${snapped.length} clip(s)…`);
  const delivery = new TelegramDeliveryProvider();
  let delivered = 0;
  for (const [i, moment] of snapped.entries()) {
    const outPath = join(opts.workDir, `clip-${i + 1}.mp4`);
    const render = await renderClip({
      sourcePath: source.videoPath,
      startSecond: moment.startSecond,
      endSecond: moment.endSecond,
      words: transcript.words,
      outPath,
      assPath: join(opts.workDir, `clip-${i + 1}.ass`),
    });
    if (!render.ok) continue;
    const result = await delivery.deliver({
      videoPath: outPath,
      caption: `🎬 ${moment.hook}\n\nClipped from "${source.title.slice(0, 90)}"`,
      documents: [],
    });
    if (result.videoSent) delivered++;
  }

  return { delivered, found: snapped.length, title: source.title };
}

/** Snap a moment's edges to word boundaries so no word is cut mid-way. */
export function snapToWords(moment: ClipMoment, words: readonly TranscriptWord[]): ClipMoment {
  if (words.length === 0) return moment;
  const startWord = words.find((w) => w.start >= moment.startSecond - 0.3) ?? words[0]!;
  const before = words.filter((w) => w.end <= moment.endSecond + 0.3);
  const endWord = before.length > 0 ? before[before.length - 1]! : startWord;
  const start = startWord.start;
  let end = Math.max(endWord.end, start + 10);
  if (end - start > 75) end = start + 75;
  return { ...moment, startSecond: start, endSecond: end };
}
