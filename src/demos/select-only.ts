/**
 * SELECTOR-ONLY HARNESS — transcribe once, cache it, then re-run moment
 * selection as often as the prompt needs tuning.
 *
 *   npm run clip:select -- "<video>" "<theme>" [count] ["<title>"]
 *
 * Why it exists: a full clip run on a twelve-minute video is ten minutes and a
 * Whisper bill, and almost all of that is spent re-deriving a transcript that
 * has not changed. That cost is what makes prompt tuning something you skip —
 * and skipping it is how "clip the goals" shipped while returning no goals.
 *
 * With the transcript cached beside the source, a selection re-run is seconds
 * and one cheap model call. That is what turned "found 4 of 5 goals" into
 * "found 5 of 5": three prompt iterations that would otherwise have cost half
 * an hour each.
 *
 * The title matters — pass the real one. A highlights title carries the
 * scoreline, and the selector counts goals against it.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { transcribe } from "../clip/transcribe.js";
import { analyzeAudio } from "../clip/audio-energy.js";
import { detectSceneCuts } from "../clip/scene-detect.js";
import { ClipMomentSelector } from "../clip/select-moments.js";
import { planForTheme, effectiveMode } from "../clip/themes.js";
import type { TranscriptSegment } from "../clip/transcribe.js";

try { process.loadEnvFile(); } catch { /* ambient */ }

const source = process.argv[2]!;
const theme = process.argv[3] ?? "the goals";
const count = Number.parseInt(process.argv[4] ?? "6", 10);
const cache = `${dirname(source)}/transcript.json`;

let segments: readonly TranscriptSegment[];
try {
  segments = JSON.parse(await readFile(cache, "utf8")) as TranscriptSegment[];
  console.log(`cached transcript: ${segments.length} segments`);
} catch {
  console.log("transcribing (once)…");
  const full = await transcribe(source, `${dirname(source)}/audio-selonly`);
  segments = full.segments;
  await mkdir(dirname(cache), { recursive: true });
  await writeFile(cache, JSON.stringify(segments), "utf8");
  console.log(`transcribed ${full.minutes} min -> ${segments.length} segments`);
}

const plan = planForTheme(theme);
const [audio, cuts] = await Promise.all([analyzeAudio(source), detectSceneCuts(source)]);
const words = segments.reduce((n, s) => n + s.text.split(/\s+/u).filter(Boolean).length, 0);
const duration = Math.max(...segments.map((s) => s.end), 0);
const mode = effectiveMode(plan, words, duration);
console.log(`mode=${mode} words=${words} duration=${Math.round(duration)}s`);

const picks = await new ClipMomentSelector().select({
  plan, mode, count, title: process.argv[5] ?? "Match highlights", description: "", durationSeconds: duration,
  segments, audio, sceneCuts: cuts, chapters: [],
  onWarn: (m) => console.log(m), onNote: (m) => console.log(m),
});
for (const p of picks) {
  console.log(`${fmt(p.startSecond)}-${fmt(p.endSecond)}  ${p.score}/100  ${p.hook}  :: ${p.reason}`);
}
function fmt(s: number): string {
  return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
}
