import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveMediaTool } from "../lib/binaries.js";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

/**
 * Transcribes a source video to word-level timestamps using OpenAI whisper-1
 * (the model that returns word timings via verbose_json). Long audio is split
 * into ≤15-minute chunks (whisper's 25 MB limit) and each chunk's timings are
 * offset back onto the full timeline, so the result is one continuous transcript.
 */

export interface TranscriptWord {
  readonly word: string;
  readonly start: number;
  readonly end: number;
}

export interface TranscriptSegment {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface Transcript {
  readonly words: readonly TranscriptWord[];
  readonly segments: readonly TranscriptSegment[];
  readonly text: string;
  /** Audio minutes transcribed (for cost). */
  readonly minutes: number;
}

const CHUNK_SECONDS = 900; // 15 min — comfortably under whisper's 25 MB/file limit at 48 kbps mono

/** Split the video's audio into compressed mono mp3 chunks; returns them in order. */
async function extractAudioChunks(videoPath: string, dir: string): Promise<string[]> {
  await mkdir(dir, { recursive: true });
  await execFileAsync(
    await resolveMediaTool("ffmpeg"),
    [
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", videoPath,
      "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "48k",
      "-f", "segment", "-segment_time", String(CHUNK_SECONDS),
      join(dir, "chunk-%03d.mp3"),
    ],
    { maxBuffer: 1024 * 1024 * 64, timeout: 15 * 60_000 },
  );
  const files = (await readdir(dir)).filter((f) => f.startsWith("chunk-") && f.endsWith(".mp3")).sort();
  return files.map((f) => join(dir, f));
}

interface WhisperVerbose {
  text?: string;
  words?: { word?: string; start?: number; end?: number }[];
  segments?: { start?: number; end?: number; text?: string }[];
}

async function transcribeChunk(apiKey: string, path: string): Promise<WhisperVerbose> {
  const buffer = await readFile(path);
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buffer)], { type: "audio/mpeg" }), "audio.mp3");
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  form.append("timestamp_granularities[]", "segment");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(10 * 60_000),
  });
  if (!res.ok) {
    throw new Error(`whisper transcription failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  return (await res.json()) as WhisperVerbose;
}

export async function transcribe(videoPath: string, dir: string): Promise<Transcript> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const chunks = await extractAudioChunks(videoPath, dir);
  const words: TranscriptWord[] = [];
  const segments: TranscriptSegment[] = [];
  const textParts: string[] = [];

  for (const [i, chunkPath] of chunks.entries()) {
    const offset = i * CHUNK_SECONDS;
    const result = await transcribeChunk(apiKey, chunkPath);
    for (const w of result.words ?? []) {
      if (typeof w.start === "number" && typeof w.end === "number" && w.word) {
        words.push({ word: w.word, start: w.start + offset, end: w.end + offset });
      }
    }
    for (const s of result.segments ?? []) {
      if (typeof s.start === "number" && typeof s.end === "number" && s.text) {
        segments.push({ start: s.start + offset, end: s.end + offset, text: s.text.trim() });
      }
    }
    if (result.text) textParts.push(result.text.trim());
  }

  return {
    words,
    segments,
    text: textParts.join(" "),
    minutes: chunks.length > 0 ? (words.at(-1)?.end ?? segments.at(-1)?.end ?? 0) / 60 : 0,
  };
}

/* ======================================================================== */
/*  WINDOWED TRANSCRIPTION                                                  */
/* ======================================================================== */

/** A span of the source video to transcribe, in seconds. */
export interface TranscribeWindow {
  readonly start: number;
  readonly end: number;
}

/**
 * Transcribe ONLY the given windows, returning word timings on the SOURCE
 * timeline.
 *
 * This is the cost lever for long sources. Selecting moments needs a rough
 * transcript of the whole video (auto-captions give us that free), but burning
 * karaoke captions needs exact word timings for the ~2 minutes that actually
 * ship. Transcribing a 2-hour podcast end to end to use 2 minutes of it is pure
 * waste; this transcribes the 2 minutes.
 *
 * Windows are padded slightly so a word straddling an edge is not cut in half,
 * and each window's timings are offset back onto the full timeline so callers
 * cannot tell the difference from a full transcript.
 */
export async function transcribeWindows(
  videoPath: string,
  windows: readonly TranscribeWindow[],
  dir: string,
): Promise<Transcript> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  await mkdir(dir, { recursive: true });

  const words: TranscriptWord[] = [];
  const segments: TranscriptSegment[] = [];
  const textParts: string[] = [];
  let seconds = 0;

  for (const [index, window] of windows.entries()) {
    // A little padding on each side: a word can straddle the boundary, and the
    // renderer discards anything outside the clip anyway.
    const start = Math.max(0, window.start - WINDOW_PAD_SECONDS);
    const duration = Math.max(1, window.end + WINDOW_PAD_SECONDS - start);
    const chunkPath = join(dir, `window-${index}.mp3`);

    try {
      await execFileAsync(
        await resolveMediaTool("ffmpeg"),
        [
          "-hide_banner", "-loglevel", "error", "-y",
          "-ss", String(start),
          "-i", videoPath,
          "-t", String(duration),
          "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "48k",
          chunkPath,
        ],
        { maxBuffer: 1024 * 1024 * 64, timeout: 5 * 60_000 },
      );
    } catch {
      continue; // a window we cannot extract simply contributes no words
    }

    const result = await transcribeChunk(apiKey, chunkPath);
    seconds += duration;

    for (const word of result.words ?? []) {
      if (typeof word.start === "number" && typeof word.end === "number" && word.word) {
        words.push({ word: word.word, start: word.start + start, end: word.end + start });
      }
    }
    for (const segment of result.segments ?? []) {
      if (typeof segment.start === "number" && typeof segment.end === "number" && segment.text) {
        segments.push({
          start: segment.start + start,
          end: segment.end + start,
          text: segment.text.trim(),
        });
      }
    }
    if (result.text) textParts.push(result.text.trim());
  }

  words.sort((a, b) => a.start - b.start);
  segments.sort((a, b) => a.start - b.start);

  return { words, segments, text: textParts.join(" "), minutes: seconds / 60 };
}

/** Padding applied either side of a window so edge words survive. */
const WINDOW_PAD_SECONDS = 1.5;
