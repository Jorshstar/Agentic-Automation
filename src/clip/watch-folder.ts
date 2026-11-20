import { mkdir, readdir, rename, stat } from "node:fs/promises";
import { join, extname, basename } from "node:path";

/**
 * WATCH FOLDER — drop a video in, get clips back.
 *
 * The point of this is size. Telegram's Bot API refuses to hand a bot any file
 * over 20 MB, which is two or three minutes of phone video, so the chat is not a
 * usable way to submit a long recording. The worker already runs on the user's
 * own machine, where the file is sitting anyway, so the shortest path is simply
 * to watch a folder.
 *
 * Layout:
 *   input/                  drop files here
 *   input/done/             moved here once clipped
 *   input/failed/           moved here if the job failed
 *
 * Telling it WHAT to clip: put it in the file name after " -- ".
 *
 *   PSG vs Barca -- the goals.mp4
 *   podcast -- key insights, with subtitles.mp4
 *   stream.mp4                                  (no theme: picks the best bits)
 *
 * Everything after the separator is passed through as the user's own words, so
 * the same phrases that work in chat work here — including "vertical",
 * "with subtitles" and "remove the watermark".
 */

export const WATCH_SEPARATOR = " -- ";

/** Containers worth trying. Anything else in the folder is ignored, not failed. */
const VIDEO_EXTENSIONS = new Set([
  ".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".flv", ".wmv", ".mpg", ".mpeg", ".ts", ".m2ts",
]);

/**
 * A file must stop changing before we touch it. Copying a two-gigabyte video
 * into the folder takes a while, and clipping a half-written file produces a
 * confusing failure rather than an obvious one.
 */
const STABLE_CHECKS = 2;

export interface WatchedFile {
  readonly path: string;
  readonly name: string;
  /** What to clip, taken from the file name. Empty means "pick the best bits". */
  readonly theme: string;
  readonly bytes: number;
}

export interface WatchFolders {
  readonly inbox: string;
  readonly done: string;
  readonly failed: string;
}

export function watchFolders(root = process.env.CLIP_WATCH_DIR?.trim() || "input"): WatchFolders {
  return { inbox: root, done: join(root, "done"), failed: join(root, "failed") };
}

export async function ensureWatchFolders(folders: WatchFolders): Promise<void> {
  await mkdir(folders.inbox, { recursive: true });
  await mkdir(folders.done, { recursive: true });
  await mkdir(folders.failed, { recursive: true });
}

/**
 * Tracks file sizes between scans so a file still being written is left alone.
 * Kept by the caller across ticks — the stability rule needs history.
 */
export class StabilityTracker {
  private readonly sizes = new Map<string, { bytes: number; stableFor: number }>();

  /** Record a size and report whether the file has settled. */
  observe(path: string, bytes: number): boolean {
    const previous = this.sizes.get(path);
    if (!previous || previous.bytes !== bytes) {
      this.sizes.set(path, { bytes, stableFor: 0 });
      return false;
    }
    const stableFor = previous.stableFor + 1;
    this.sizes.set(path, { bytes, stableFor });
    return stableFor >= STABLE_CHECKS;
  }

  forget(path: string): void {
    this.sizes.delete(path);
  }
}

/**
 * Videos sitting in the inbox that have finished copying. Sub-folders (done,
 * failed) are skipped, so a processed file is never picked up twice.
 */
export async function scanWatchFolder(
  folders: WatchFolders,
  tracker: StabilityTracker,
): Promise<readonly WatchedFile[]> {
  let entries: string[];
  try {
    entries = await readdir(folders.inbox);
  } catch {
    return []; // folder not created yet — nothing to do
  }

  const ready: WatchedFile[] = [];
  for (const name of entries) {
    if (name.startsWith(".")) continue; // partial downloads, OS metadata
    if (!VIDEO_EXTENSIONS.has(extname(name).toLowerCase())) continue;

    const path = join(folders.inbox, name);
    let info;
    try {
      info = await stat(path);
    } catch {
      continue; // vanished between readdir and stat
    }
    if (!info.isFile() || info.size === 0) continue;

    if (!tracker.observe(path, info.size)) continue; // still being written

    ready.push({ path, name, theme: themeFromName(name), bytes: info.size });
  }
  return ready;
}

/**
 * Pull the request out of the file name: everything after " -- ", minus the
 * extension. Returns "" when there is no separator, which the caller reads as
 * "pick the best bits".
 */
export function themeFromName(fileName: string): string {
  const withoutExtension = basename(fileName, extname(fileName));
  const index = withoutExtension.indexOf(WATCH_SEPARATOR);
  if (index === -1) return "";
  return withoutExtension.slice(index + WATCH_SEPARATOR.length).trim();
}

/**
 * Move a finished file out of the inbox. Never overwrites: a name collision gets
 * a numeric suffix, because silently replacing the user's video would be worse
 * than an untidy folder.
 */
export async function archive(file: WatchedFile, folders: WatchFolders, ok: boolean): Promise<string> {
  const target = ok ? folders.done : folders.failed;
  await mkdir(target, { recursive: true });

  const extension = extname(file.name);
  const stem = basename(file.name, extension);
  for (let attempt = 0; attempt < 100; attempt++) {
    const candidate = join(target, attempt === 0 ? file.name : `${stem} (${attempt})${extension}`);
    try {
      await stat(candidate);
      continue; // taken — try the next suffix
    } catch {
      await rename(file.path, candidate);
      return candidate;
    }
  }
  return file.path; // 100 collisions: leave it where it is rather than guess
}
