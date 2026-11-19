import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, chmod, mkdir, writeFile } from "node:fs/promises";
import { constants, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

/**
 * EXTERNAL BINARY RESOLUTION — finding ffmpeg, ffprobe and yt-dlp wherever they
 * actually are, instead of assuming a bare name resolves on PATH.
 *
 * Why this exists: every media call used to invoke `"ffmpeg"` directly, so a
 * machine with ffmpeg installed but not on PATH failed with a bare ENOENT
 * halfway through a job, after the download had already been paid for. That is
 * the common case on Windows, where the usual install is an unzipped folder
 * that nothing adds to PATH.
 *
 * Resolution order for each tool:
 *   1. An explicit override: FFMPEG_PATH / FFPROBE_PATH / YT_DLP_PATH.
 *   2. The bare name, if it runs (i.e. it really is on PATH).
 *   3. Well-known install locations for the platform.
 *   4. For yt-dlp only: download the official standalone build and cache it,
 *      because it is a single self-contained file and it goes stale fast.
 *
 * Results are cached for the process, including failures-to-find, so a missing
 * tool is diagnosed once rather than on every call.
 *
 * A NOTE ON WSL. Under WSL the Windows ffmpeg.exe is visible at
 * /mnt/c/..., and it is tempting to use it. Do not: it receives Linux paths it
 * cannot open, and the filtergraph needs a different colon escape from a plain
 * path argument, so it works only behind a translation shim. We treat it as
 * absent and say so in the error, which is the honest answer.
 */

export type MediaTool = "ffmpeg" | "ffprobe";

const OVERRIDE_ENV: Readonly<Record<MediaTool, string>> = {
  ffmpeg: "FFMPEG_PATH",
  ffprobe: "FFPROBE_PATH",
};

const resolved = new Map<string, Promise<string>>();

/** True when running under WSL, where Windows binaries are visible but unusable. */
export function isWsl(): boolean {
  if (process.platform !== "linux") return false;
  try {
    // Synchronous read of a tiny virtual file; this runs once per error path.
    return /microsoft/iu.test(readFileSync("/proc/version", "utf8"));
  } catch {
    return false;
  }
}

function candidatePaths(tool: MediaTool): string[] {
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA ?? "";
    const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
    return [
      `C:\\ffmpeg\\bin\\${tool}.exe`,
      `${programFiles}\\ffmpeg\\bin\\${tool}.exe`,
      localAppData === "" ? "" : `${localAppData}\\Microsoft\\WinGet\\Links\\${tool}.exe`,
      `C:\\ProgramData\\chocolatey\\bin\\${tool}.exe`,
    ].filter((path) => path !== "");
  }
  return [
    `/usr/bin/${tool}`,
    `/usr/local/bin/${tool}`,
    `/snap/bin/${tool}`,
    `/opt/homebrew/bin/${tool}`,
  ];
}

/** Whether this path actually runs. The only reliable test is to run it. */
async function runs(path: string): Promise<boolean> {
  try {
    await execFileAsync(path, ["-version"], { timeout: 20_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * The path to use for a media tool. Throws a message that says exactly what to
 * install, rather than letting an ENOENT surface from deep inside a filtergraph.
 */
export async function resolveMediaTool(tool: MediaTool): Promise<string> {
  const cached = resolved.get(tool);
  if (cached) return cached;

  const lookup = (async (): Promise<string> => {
    const override = process.env[OVERRIDE_ENV[tool]]?.trim();
    if (override && override !== "") {
      if (await runs(override)) return override;
      throw new Error(`${OVERRIDE_ENV[tool]} is set but "${override}" does not run.`);
    }
    if (await runs(tool)) return tool;
    for (const candidate of candidatePaths(tool)) {
      if (await runs(candidate)) return candidate;
    }
    throw new Error(missingToolMessage(tool));
  })();

  resolved.set(tool, lookup);
  // A rejected promise left in the cache would make every later call an
  // unhandled rejection, so drop it and let the next call retry.
  lookup.catch(() => resolved.delete(tool));
  return lookup;
}

function missingToolMessage(tool: MediaTool): string {
  const base = `${tool} was not found.`;
  if (process.platform === "win32") {
    return (
      `${base} Install it (winget install Gyan.FFmpeg) or unzip a build to C:\\ffmpeg, ` +
      `then either add C:\\ffmpeg\\bin to PATH or set ${OVERRIDE_ENV[tool]} to the full ` +
      `path of ${tool}.exe.`
    );
  }
  if (isWsl()) {
    return (
      `${base} You are on WSL. Install it INSIDE WSL with "sudo apt install ffmpeg" — ` +
      `a Windows build under /mnt/c cannot be used from here, because it receives Linux ` +
      `paths it cannot open. Alternatively run the studio from Windows instead of WSL.`
    );
  }
  return `${base} Install it with "sudo apt install ffmpeg" (or your package manager), or set ${OVERRIDE_ENV[tool]}.`;
}

/**
 * Check every media tool up front and fail with ONE clear message naming all of
 * them. Call this before a long job so a missing binary is reported in seconds
 * rather than after a multi-hundred-megabyte download.
 */
export async function assertMediaTools(): Promise<void> {
  const problems: string[] = [];
  for (const tool of ["ffmpeg", "ffprobe"] as const) {
    try {
      await resolveMediaTool(tool);
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (problems.length > 0) throw new Error(problems.join("\n"));
}

/* ------------------------------- yt-dlp ------------------------------- */

/**
 * yt-dlp is handled differently from ffmpeg: it is a single self-contained file
 * and it goes stale FAST — YouTube breaks old versions, and a distro package is
 * often months behind, which shows up as an HTTP 400 on the player page. So we
 * fetch the official standalone build at runtime and cache it, on every platform
 * rather than Linux alone (Windows used to be left to fend for itself on PATH).
 */
const YT_DLP_ASSET: Readonly<Record<string, string>> = {
  linux: "yt-dlp_linux",
  darwin: "yt-dlp_macos",
  win32: "yt-dlp.exe",
};

let ytDlpLookup: Promise<string> | undefined;

export async function resolveYtDlp(): Promise<string> {
  if (ytDlpLookup) return ytDlpLookup;

  ytDlpLookup = (async (): Promise<string> => {
    const override = process.env.YT_DLP_PATH?.trim();
    if (override && override !== "") return override;

    const asset = YT_DLP_ASSET[process.platform];
    if (!asset) return "yt-dlp"; // unknown platform — trust PATH

    const cachePath = join(tmpdir(), process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
    try {
      await access(cachePath, constants.X_OK);
      return cachePath;
    } catch {
      // not cached yet
    }

    try {
      const response = await fetch(
        `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`,
        { redirect: "follow", signal: AbortSignal.timeout(180_000) },
      );
      if (!response.ok) throw new Error(`fetch yt-dlp failed (${response.status})`);
      await mkdir(tmpdir(), { recursive: true });
      await writeFile(cachePath, new Uint8Array(await response.arrayBuffer()));
      if (process.platform !== "win32") await chmod(cachePath, 0o755);
      return cachePath;
    } catch {
      // Fall back to whatever is on PATH; downloadSource turns a failure there
      // into a message naming the real reason.
      return "yt-dlp";
    }
  })();

  ytDlpLookup.catch(() => {
    ytDlpLookup = undefined;
  });
  return ytDlpLookup;
}

/** Test seam: forget every cached lookup. */
export function resetBinaryCache(): void {
  resolved.clear();
  ytDlpLookup = undefined;
}
