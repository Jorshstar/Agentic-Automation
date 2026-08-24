/**
 * Runs the WHOLE clip pipeline locally and delivers the clips to Telegram —
 * the same steps as the clip-video cloud task. Used to validate end-to-end and
 * to produce clips while the cloud waits on YouTube cookies.
 *
 *   npx tsx src/demos/clip-run-demo.ts "<url>" "<theme>" <count>
 */
import { join } from "node:path";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { downloadSource } from "../clip/source-download.js";
import { transcribe } from "../clip/transcribe.js";
import type { Transcript, TranscriptWord } from "../clip/transcribe.js";
import type { DownloadedSource } from "../clip/source-download.js";
import { energyPeaks } from "../clip/audio-energy.js";
import { ClaudeMomentSelectionProvider, removeOverlaps } from "../clip/select-moments.js";
import type { ClipMoment } from "../clip/select-moments.js";
import { renderClip } from "../clip/render-clip.js";
import { TelegramDeliveryProvider } from "../providers/delivery/index.js";

try {
  process.loadEnvFile();
} catch {
  /* ambient */
}

function snapToWords(moment: ClipMoment, words: readonly TranscriptWord[]): ClipMoment {
  if (words.length === 0) return moment;
  const startWord = words.find((w) => w.start >= moment.startSecond - 0.3) ?? words[0]!;
  const before = words.filter((w) => w.end <= moment.endSecond + 0.3);
  const endWord = before.length > 0 ? before[before.length - 1]! : startWord;
  const start = startWord.start;
  let end = Math.max(endWord.end, start + 10);
  if (end - start > 75) end = start + 75;
  return { ...moment, startSecond: start, endSecond: end };
}

async function main(): Promise<void> {
  const url = process.argv[2] ?? "https://youtu.be/EiYn6IQ6Zvw";
  const theme = process.argv[3] ?? "auto";
  const count = Number.parseInt(process.argv[4] ?? "4", 10);
  const dir = "output/cliprun";

  // Cache the expensive stages so re-runs (frame/selection tweaks) are cheap.
  const metaPath = join(dir, "meta.json");
  const trPath = join(dir, "transcript.json");

  let source: DownloadedSource;
  if (existsSync(join(dir, "source.mp4")) && existsSync(metaPath)) {
    console.log("♻️ reusing downloaded source");
    source = JSON.parse(await readFile(metaPath, "utf8")) as DownloadedSource;
  } else {
    console.log(`⛏ downloading ${url}`);
    source = await downloadSource(url, dir);
    await writeFile(metaPath, JSON.stringify(source), "utf8");
  }
  console.log(`   "${source.title}" (${Math.round(source.durationSeconds / 60)} min)`);

  console.log("📝 transcribing + scanning loudness…");
  const transcribeOrCache = async (): Promise<Transcript> => {
    if (existsSync(trPath)) {
      console.log("♻️ reusing transcript");
      return JSON.parse(await readFile(trPath, "utf8")) as Transcript;
    }
    const t = await transcribe(source.videoPath, join(dir, "audio"));
    await writeFile(trPath, JSON.stringify(t), "utf8");
    return t;
  };
  const [transcript, peaks] = await Promise.all([
    transcribeOrCache(),
    energyPeaks(source.videoPath),
  ]);
  console.log(`   ${transcript.words.length} words, ${transcript.segments.length} segments, ${peaks.length} loud peaks`);

  console.log(`🎯 selecting "${theme}" moments…`);
  const moments = await new ClaudeMomentSelectionProvider().select({
    theme, count,
    title: source.title,
    description: source.description,
    durationSeconds: source.durationSeconds,
    segments: transcript.segments,
    peaks,
    chapters: source.chapters,
  });
  const snapped = removeOverlaps(moments.map((m) => snapToWords(m, transcript.words)).filter((m) => m.endSecond - m.startSecond >= 10));
  console.log(`   ${snapped.length} clips:`);
  snapped.forEach((m, i) => console.log(`   ${i + 1}. [${fmt(m.startSecond)}-${fmt(m.endSecond)}] ${m.hook}`));

  const delivery = new TelegramDeliveryProvider();
  let delivered = 0;
  for (const [i, m] of snapped.entries()) {
    const out = join(dir, `clip-${i + 1}.mp4`);
    console.log(`✂️ rendering clip ${i + 1}…`);
    const r = await renderClip({
      sourcePath: source.videoPath,
      startSecond: m.startSecond,
      endSecond: m.endSecond,
      words: transcript.words,
      outPath: out,
      assPath: join(dir, `clip-${i + 1}.ass`),
    });
    if (!r.ok) {
      console.log(`   render failed: ${r.stderr.slice(0, 200)}`);
      continue;
    }
    const res = await delivery.deliver({ videoPath: out, caption: `🎬 ${m.hook}\n\nClipped from "${source.title.slice(0, 90)}"`, documents: [] });
    if (res.videoSent) delivered++;
    console.log(`   clip ${i + 1} sent: ${res.videoSent}`);
  }
  console.log(`\n✅ delivered ${delivered}/${snapped.length} clips`);
}

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s % 60)).padStart(2, "0")}`;
}

main().catch((e: unknown) => {
  console.error("clip-run failed:", e);
  process.exitCode = 1;
});
