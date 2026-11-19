import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveMediaTool } from "./binaries.js";

/**
 * Small media utilities — thin, read-only wrappers around ffprobe.
 *
 * This is a UTILITY, not an architectural layer. It only *measures* media (it
 * never composes, encodes, or renders). Production stages use it to learn the
 * real duration of audio/video so the timeline can be built from actual output
 * rather than estimates. ffprobe ships alongside ffmpeg and must be on PATH.
 */

const execFileAsync = promisify(execFile);

/**
 * Return a media file's duration in seconds, or `undefined` if it can't be
 * measured (missing file, ffprobe not installed, unreadable media). Never throws
 * — callers decide how to handle a missing measurement.
 */
export async function probeDurationSeconds(filePath: string): Promise<number | undefined> {
  try {
    const { stdout } = await execFileAsync(await resolveMediaTool("ffprobe"), [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    const seconds = Number.parseFloat(stdout.trim());
    return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Return ffprobe's full JSON (`-show_format -show_streams`) for a file, or
 * `undefined` if it can't be probed. The shape is provider-specific, so callers
 * parse it defensively. Never throws.
 */
export async function probeJson(filePath: string): Promise<unknown | undefined> {
  try {
    const { stdout } = await execFileAsync(await resolveMediaTool("ffprobe"), [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      filePath,
    ]);
    return JSON.parse(stdout) as unknown;
  } catch {
    return undefined;
  }
}

/** Whether ffprobe is available on PATH. */
export async function isFfprobeAvailable(): Promise<boolean> {
  try {
    await execFileAsync(await resolveMediaTool("ffprobe"), ["-version"]);
    return true;
  } catch {
    return false;
  }
}

/** Result of an ffmpeg invocation. */
export interface FfmpegResult {
  readonly ok: boolean;
  /** ffmpeg's stderr (errors only); truncated. Empty on clean success. */
  readonly stderr: string;
}

/**
 * Run ffmpeg with the given args (errors-only logging, no shell — args are passed
 * directly, so no quoting/escaping pitfalls). Never throws; returns `ok=false`
 * with stderr so callers can turn a failure into a warning.
 */
export async function runFfmpeg(args: readonly string[]): Promise<FfmpegResult> {
  try {
    const { stderr } = await execFileAsync(
      await resolveMediaTool("ffmpeg"),
      ["-hide_banner", "-loglevel", "error", ...args],
      { maxBuffer: 1024 * 1024 * 64 },
    );
    return { ok: true, stderr: (stderr ?? "").slice(0, 2000) };
  } catch (error) {
    const stderr =
      (error as { stderr?: string }).stderr ??
      (error instanceof Error ? error.message : String(error));
    return { ok: false, stderr: String(stderr).slice(0, 2000) };
  }
}
