import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, chmod, access } from "node:fs/promises";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

/**
 * Debian's apt yt-dlp is often months stale, and YouTube breaks old versions
 * (HTTP 400 on the API page). So on Linux (the cloud) we fetch the latest
 * standalone yt-dlp binary at runtime and use THAT. Locally (Windows/mac) we use
 * whatever yt-dlp is on PATH. Override with YT_DLP_PATH if needed.
 */
const YT_DLP_LATEST = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux";
const YT_DLP_CACHE = "/tmp/yt-dlp";
let cachedYtDlp: string | undefined;

async function ensureYtDlp(): Promise<string> {
  if (process.env.YT_DLP_PATH) return process.env.YT_DLP_PATH;
  if (process.platform !== "linux") return "yt-dlp";
  if (cachedYtDlp) return cachedYtDlp;
  try {
    await access(YT_DLP_CACHE);
    cachedYtDlp = YT_DLP_CACHE;
    return cachedYtDlp;
  } catch {
    // not cached yet — download it
  }
  try {
    const res = await fetch(YT_DLP_LATEST, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`fetch yt-dlp failed (${res.status})`);
    await writeFile(YT_DLP_CACHE, new Uint8Array(await res.arrayBuffer()));
    await chmod(YT_DLP_CACHE, 0o755);
    cachedYtDlp = YT_DLP_CACHE;
    return cachedYtDlp;
  } catch {
    return "yt-dlp"; // fall back to the apt build if the download fails
  }
}

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
  const bin = await ensureYtDlp();
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
