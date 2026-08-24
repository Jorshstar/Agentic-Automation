import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { runFfmpeg } from "../lib/media.js";
import type { TranscriptWord } from "./transcribe.js";

/**
 * Renders one vertical (1080x1920) clip from the source: cut the time range,
 * reframe 16:9 → 9:16 with a blurred-fill background (nothing important cropped
 * away), and burn word-level karaoke captions built from the real word timings.
 */

const WIDTH = 1080;
const HEIGHT = 1920;
const ACCENT = "&H0033DDFF"; // ASS BGR for #FFDD33 (yellow) — the karaoke flip colour

export interface RenderClipInput {
  readonly sourcePath: string;
  readonly startSecond: number;
  readonly endSecond: number;
  readonly words: readonly TranscriptWord[];
  readonly outPath: string;
  readonly assPath: string;
}

export async function renderClip(input: RenderClipInput): Promise<{ ok: boolean; stderr: string }> {
  await mkdir(dirname(input.outPath), { recursive: true });
  const duration = Math.max(1, input.endSecond - input.startSecond);

  // Words that fall inside this clip, re-based to clip-local time.
  const local = input.words
    .filter((w) => w.end > input.startSecond && w.start < input.endSecond)
    .map((w) => ({
      word: w.word.trim(),
      start: Math.max(0, w.start - input.startSecond),
      end: Math.max(0, Math.min(duration, w.end - input.startSecond)),
    }))
    .filter((w) => w.word !== "");
  await writeFile(input.assPath, buildAss(local), "utf8");

  const subs = input.assPath.replace(/\\/gu, "/").replace(/:/gu, "\\:");
  // FIT-WHOLE: show the ENTIRE source frame at natural size over a blurred fill of
  // itself — the video sits centred with soft blurred bars above/below. Nothing
  // cropped, nothing zoomed. This is the look the user picked.
  const filter =
    `[0:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},boxblur=40:2,setsar=1[bg];` +
    `[0:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,setsar=1[fg];` +
    `[bg][fg]overlay=(W-w)/2:(H-h)/2[base];` +
    `[base]subtitles='${subs}'[v]`;

  return runFfmpeg([
    "-y",
    "-ss", String(input.startSecond),
    "-i", input.sourcePath,
    "-t", String(duration),
    "-filter_complex", filter,
    "-map", "[v]",
    "-map", "0:a?",
    "-c:v", "libx264", "-preset", "fast", "-crf", "19", "-pix_fmt", "yuv420p",
    "-threads", "2",
    "-c:a", "aac", "-b:a", "160k",
    "-movflags", "+faststart",
    input.outPath,
  ]);
}

/* --------------------------------- ASS --------------------------------- */

interface LocalWord {
  readonly word: string;
  readonly start: number;
  readonly end: number;
}

/** Group words into short caption lines and render karaoke ASS from real timings. */
function buildAss(words: readonly LocalWord[]): string {
  const fontSize = Math.round(HEIGHT / 22); // bold, TikTok-sized
  const marginH = Math.round(WIDTH * 0.08);
  const marginV = Math.round(HEIGHT * 0.22);
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${WIDTH}`,
    `PlayResY: ${HEIGHT}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,Arial,${fontSize},${ACCENT},&H00FFFFFF,&H00000000,&H64000000,1,0,0,0,100,100,0,0,1,4,2,2,${marginH},${marginH},${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");

  const lines = groupLines(words);
  const events = lines
    .map((line) => {
      const start = line[0]!.start;
      const end = line.at(-1)!.end;
      const body = line
        .map((w) => `{\\k${Math.max(1, Math.round((w.end - w.start) * 100))}}${w.word.replace(/[{}]/gu, "")}`)
        .join(" ");
      return `Dialogue: 0,${assTime(start)},${assTime(end)},Default,,0,0,0,,${body}`;
    })
    .join("\n");

  return `${header}\n${events}\n`;
}

/** Break the word stream into caption lines (~4 words, or on a >0.6s pause). */
function groupLines(words: readonly LocalWord[]): LocalWord[][] {
  const lines: LocalWord[][] = [];
  let current: LocalWord[] = [];
  for (const w of words) {
    if (current.length > 0) {
      const prev = current.at(-1)!;
      const gap = w.start - prev.end;
      if (current.length >= 4 || gap > 0.6) {
        lines.push(current);
        current = [];
      }
    }
    current.push(w);
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

function assTime(seconds: number): string {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360_000);
  const m = Math.floor((cs % 360_000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const centis = cs % 100;
  return `${h}:${pad(m)}:${pad(s)}.${pad(centis)}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
