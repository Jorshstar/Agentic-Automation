import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, chmod, access, readdir, readFile, rm } from "node:fs/promises";
import { probeDurationSeconds } from "../lib/media.js";
import type { TranscriptSegment } from "./transcribe.js";
import { join } from "node:path";
import { resolveYtDlp } from "../lib/binaries.js";

const execFileAsync = promisify(execFile);

/**
 * yt-dlp resolution (download-the-latest-standalone, cache it) lives in
 * lib/binaries.ts now, so Windows gets the same self-healing behaviour Linux
 * already had. Override with YT_DLP_PATH.
 */

/**
 * Client selection. The worker runs on a RESIDENTIAL IP, where yt-dlp's default
 * (web) client works AND serves full 1080p formats — so we don't override it.
 * The TV/mobile clients (a datacenter bot-check bypass) only serve low-res
 * (~360p), which is why forcing them made clips blurry. Only override if the
 * caller explicitly sets YT_DLP_CLIENTS (e.g. for a future cloud/proxy path).
 */
function clientArgs(_hasCookies: boolean): string[] {
  const clients = process.env.YT_DLP_CLIENTS;
  return clients && clients.trim() !== "" ? ["--extractor-args", `youtube:player_client=${clients.trim()}`] : [];
}
const MODERN_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/**
 * Optional cookies fallback for videos that still demand sign-in. Set the env var
 * YT_DLP_COOKIES to the full contents of a Netscape cookies.txt exported from a
 * logged-in browser; it's written to disk and passed with --cookies.
 */
async function cookieArgs(dir: string): Promise<string[]> {
  const raw = process.env.YT_DLP_COOKIES;
  if (!raw || raw.trim() === "") return [];
  const path = join(dir, "cookies.txt");
  await writeFile(path, normalizeCookies(raw), "utf8");
  return ["--cookies", path];
}

/**
 * Rebuild a valid Netscape cookies.txt from a pasted value. Dashboards and
 * copy-paste often flatten the required TABs and newlines into spaces, which
 * yt-dlp can't parse. Cookie fields never contain whitespace, so we regex out
 * each 7-field record (domain, flag, path, secure, expiry, name, value) — the
 * TRUE/FALSE + numeric-expiry anchors make this reliable — and re-tab them.
 */
function normalizeCookies(raw: string): string {
  const re = /(\S+)\s+(TRUE|FALSE)\s+(\S+)\s+(TRUE|FALSE)\s+(-?\d+)\s+(\S+)\s+(\S+)/g;
  const lines: string[] = [];
  for (const m of raw.matchAll(re)) {
    lines.push([m[1], m[2], m[3], m[4], m[5], m[6], m[7]].join("\t"));
  }
  if (lines.length === 0) {
    // Couldn't parse records — trust the raw value as-is (maybe already valid).
    return raw;
  }
  return `# Netscape HTTP Cookie File\n${lines.join("\n")}\n`;
}

/** Run yt-dlp; on failure throw an error carrying the REAL reason (its stderr). */
async function runYtdlp(args: readonly string[], timeoutMs: number): Promise<string> {
  const bin = await resolveYtDlp();
  try {
    const { stdout } = await execFileAsync(bin, args, { maxBuffer: 1024 * 1024 * 64, timeout: timeoutMs });
    return stdout;
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? "";
    // Prefer yt-dlp's own ERROR/WARNING lines over the giant command echo.
    const meaningful = stderr
      .split(/\r?\n/)
      .filter((l) => /error|sign in|not a bot|unavailable|private|cookies/i.test(l))
      .slice(-4)
      .join("\n")
      .trim();
    throw new Error(meaningful || stderr.slice(-400) || (error instanceof Error ? error.message : String(error)));
  }
}

/**
 * Downloads a long source video with yt-dlp and reads its metadata. yt-dlp is
 * installed in the deploy image (see trigger.config aptGet). Handles YouTube and
 * any direct/other URL yt-dlp supports.
 */

export interface SourceChapter {
  readonly title: string;
  readonly startSecond: number;
  readonly endSecond: number;
}

export interface DownloadedSource {
  readonly videoPath: string;
  readonly title: string;
  readonly description: string;
  readonly durationSeconds: number;
  readonly chapters: readonly SourceChapter[];
}

interface YtdlpInfo {
  title?: string;
  description?: string;
  duration?: number;
  chapters?: { title?: string; start_time?: number; end_time?: number }[];
}

/** Fetch metadata only (no download) so we can size the job before paying to pull. */
export async function probeSource(url: string, dir = "."): Promise<YtdlpInfo> {
  const cookies = await cookieArgs(dir);
  const stdout = await runYtdlp(
    [
      "--dump-single-json", "--no-playlist", "--no-warnings",
      "--user-agent", MODERN_UA,
      ...clientArgs(cookies.length > 0),
      ...cookies,
      url,
    ],
    120_000,
  );
  return JSON.parse(stdout) as YtdlpInfo;
}

/**
 * Download the source (≤1080p mp4) into `dir` and return its path + metadata.
 * Throws on failure (bad URL, YouTube bot-check, private video) — the caller
 * turns that into a friendly Telegram message.
 */
export async function downloadSource(url: string, dir: string): Promise<DownloadedSource> {
  await mkdir(dir, { recursive: true });
  const cookies = await cookieArgs(dir);
  const info = await probeSource(url, dir).catch(() => ({}) as YtdlpInfo);

  const videoPath = `${dir}/source.mp4`;
  await runYtdlp(
    [
      "-f",
      // Best 1080p video + best audio, MERGED. No ext lock — locking to mp4/m4a
      // excludes YouTube's high-res vp9/av1 streams and drops to the 360p
      // progressive file. Merge to mp4 at the end instead.
      "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best",
      "--merge-output-format",
      "mp4",
      "--no-playlist",
      "--no-warnings",
      "--force-overwrites",
      "--user-agent",
      MODERN_UA,
      ...clientArgs(cookies.length > 0),
      ...cookies,
      "-o",
      videoPath,
      url,
    ],
    20 * 60_000,
  );

  const chapters: SourceChapter[] = (info.chapters ?? [])
    .filter((c) => typeof c.start_time === "number")
    .map((c) => ({
      title: (c.title ?? "").slice(0, 120),
      startSecond: c.start_time ?? 0,
      endSecond: c.end_time ?? 0,
    }));

  return {
    videoPath,
    title: (info.title ?? "source video").slice(0, 200),
    description: (info.description ?? "").slice(0, 4000),
    durationSeconds: typeof info.duration === "number" ? info.duration : 0,
    chapters,
  };
}

/* ======================================================================== */
/*  SOURCE RESOLUTION — a job may start from a link OR from a file already   */
/*  on disk (a Telegram upload, a local render, a manual drop).              */
/* ======================================================================== */

/**
 * Distinguish a URL from a filesystem path. Anything with a scheme we treat as
 * a link for yt-dlp; everything else is a local file. Deliberately simple —
 * yt-dlp itself is the authority on which links it can handle.
 */
export function isRemoteUrl(input: string): boolean {
  return /^(https?|ftp|rtmp|rtsp):\/\//iu.test(input.trim());
}

/**
 * Load a video that is already on disk. No download, no network, no cost — the
 * path a Telegram upload or a local file takes. Title falls back to the file
 * name, which is usually what the user recognises anyway.
 */
export async function loadLocalSource(path: string): Promise<DownloadedSource> {
  await access(path); // throws a clear ENOENT if the caller passed a bad path
  const durationSeconds = (await probeDurationSeconds(path)) ?? 0;
  if (durationSeconds <= 0) {
    throw new Error(`Could not read "${path}" as a video — is it a valid media file?`);
  }
  const title = (path.split(/[\\/]/u).pop() ?? "uploaded video").replace(/\.[^.]+$/u, "");
  return { videoPath: path, title: title.slice(0, 200), description: "", durationSeconds, chapters: [] };
}

/**
 * The single entry point for getting a source video, whatever the user gave us.
 */
export async function resolveSource(input: string, dir: string): Promise<DownloadedSource> {
  const trimmed = input.trim();
  if (isRemoteUrl(trimmed)) return downloadSource(trimmed, dir);
  return loadLocalSource(trimmed);
}

/* ======================================================================== */
/*  FREE TRANSCRIPT — YouTube's own auto-captions.                          */
/* ======================================================================== */

/**
 * Fetch the platform's auto-generated captions without downloading the video.
 *
 * Why: transcribing a two-hour podcast with Whisper costs real money, and we
 * only need caption-grade accuracy for the ~2 minutes that actually become
 * clips. Auto-captions are free, instant, and more than good enough to CHOOSE
 * moments from. The pipeline uses them for selection and then spends Whisper
 * only on the chosen windows — roughly a 90% cut on a long source.
 *
 * Returns undefined whenever captions are unavailable (most non-YouTube hosts,
 * or a video with them disabled), and the caller falls back to transcribing.
 */
export async function fetchAutoCaptions(url: string, dir: string): Promise<TranscriptSegment[] | undefined> {
  try {
    // Start from an EMPTY directory. We pick the subtitle file up off disk after
    // yt-dlp runs, so anything left from a previous fetch is indistinguishable
    // from a fresh download — a source with no captions of its own would silently
    // inherit the last video's transcript and be clipped from the wrong words.
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    const cookies = await cookieArgs(dir);
    const output = join(dir, "subs");
    await runYtdlp(
      [
        "--skip-download",
        "--write-auto-subs",
        "--write-subs",
        "--sub-langs", "en.*,en",
        "--sub-format", "vtt",
        "--no-playlist",
        "--no-warnings",
        "--user-agent", MODERN_UA,
        ...clientArgs(cookies.length > 0),
        ...cookies,
        "-o", output,
        url,
      ],
      5 * 60_000,
    );

    const files = (await readdir(dir)).filter((name) => name.endsWith(".vtt"));
    if (files.length === 0) return undefined;
    // Prefer a plain English track over a machine translation when both exist.
    const preferred = files.find((name) => /\.en(-orig)?\.vtt$/u.test(name)) ?? files[0]!;
    const vtt = await readFile(join(dir, preferred), "utf8");
    const segments = parseVtt(vtt);
    return segments.length > 0 ? segments : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Parse WebVTT into plain timed segments.
 *
 * YouTube's auto-caption VTT is awkward in two specific ways that a naive parser
 * gets wrong, and both are handled here:
 *
 *   1. Inline karaoke markup — `<00:00:04.120><c>word</c>` — appears inside the
 *      cue text and has to be stripped or it ends up in the prompt.
 *   2. Cues ROLL: the caption box holds two lines and scrolls, so a line shows
 *      up as the BOTTOM line of one cue and again as the TOP line of the next.
 *      Comparing whole cues is not enough — the repeat is a partial overlap at
 *      either end. We merge on word overlap instead: the leading words of a new
 *      cue that we have just emitted are dropped, and a cue that repeats
 *      entirely is skipped. Without this the transcript reads every line two or
 *      three times, which wastes prompt budget and confuses the selector.
 */
export function parseVtt(vtt: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const blocks = vtt.replace(/\r/gu, "").split(/\n\n+/u);
  /** A rolling window of the words already emitted, for overlap detection. */
  let emitted: string[] = [];

  for (const block of blocks) {
    const lines = block.split("\n");
    const timingLine = lines.find((line) => line.includes("-->"));
    if (!timingLine) continue;

    const match = timingLine.match(
      /(\d{1,2}:\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{3})/u,
    );
    if (!match) continue;

    const start = vttTimeToSeconds(match[1]!);
    const end = vttTimeToSeconds(match[2]!);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;

    const text = lines
      .slice(lines.indexOf(timingLine) + 1)
      .join(" ")
      .replace(/<[^>]*>/gu, "") // strip <c> spans and inline timestamps
      .replace(/&nbsp;/gu, " ")
      .replace(/&amp;/gu, "&")
      .replace(/&#39;/gu, "'")
      .replace(/&quot;/gu, '"')
      .replace(/\s+/gu, " ")
      .trim();
    if (text === "") continue;

    // Drop the words at the head of this cue that we have already emitted.
    const words = text.split(" ").filter((word) => word !== "");
    const overlap = overlapWords(emitted, words);
    const fresh = words.slice(overlap);
    if (fresh.length === 0) continue; // the cue was entirely a repeat

    segments.push({ start, end, text: fresh.join(" ") });
    // Keep the window short: an overlap never spans more than a caption box.
    emitted = [...emitted, ...fresh].slice(-40);
  }
  return segments;
}

/**
 * How many words at the START of `next` already appear at the END of `emitted`.
 * Matching on whole words rather than characters keeps a partial match from
 * slicing a word in half.
 */
function overlapWords(emitted: readonly string[], next: readonly string[]): number {
  const max = Math.min(emitted.length, next.length);
  for (let size = max; size > 0; size--) {
    let same = true;
    for (let i = 0; i < size; i++) {
      if (emitted[emitted.length - size + i] !== next[i]) {
        same = false;
        break;
      }
    }
    if (same) return size;
  }
  return 0;
}

function vttTimeToSeconds(value: string): number {
  const [hours, minutes, rest] = value.replace(",", ".").split(":");
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(rest);
}
