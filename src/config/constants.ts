import type { Niche, Platform } from "../types/index.js";

/**
 * Application constants — fixed values that never change at runtime.
 *
 * Everything here is `as const`, which makes it deeply immutable AND gives it
 * the most precise type possible (e.g. the literal `60`, not just `number`).
 * Keeping these in one place means there is a single source of truth: change a
 * rule once here and the whole app follows.
 */

/** Target length of every generated video, in seconds (60-70s window). */
export const VIDEO_DURATION_SECONDS = 65 as const;

/** How many days a single niche stays active before the rotation advances.
 *  1 = a different niche every day (scary → tech → relationship → storytelling → …). */
export const NICHE_ROTATION_DAYS = 1 as const;

/**
 * Every niche the studio supports.
 * `satisfies readonly Niche[]` makes TypeScript verify each entry is a real
 * Niche, so a typo here is a compile error rather than a runtime surprise.
 */
export const SUPPORTED_NICHES = [
  "scary-stories",
  "tech-news",
  "relationship-advice",
  "user-storytelling",
] as const satisfies readonly Niche[];

/** Platforms a finished video is uploaded to (manually, for now). */
export const SUPPORTED_PLATFORMS = ["youtube", "tiktok"] as const satisfies readonly Platform[];

/**
 * Sub-folder names used when a finished package is written to disk / Drive /
 * cloud storage (built in a later step). Centralised so every storage backend
 * lays out files the same way.
 */
export const OUTPUT_DIRECTORIES = {
  root: "output",
  scripts: "scripts",
  audio: "audio",
  video: "video",
  metadata: "metadata",
} as const;

/** Convenience type: the keys of {@link OUTPUT_DIRECTORIES} (e.g. "scripts"). */
export type OutputDirectoryKey = keyof typeof OUTPUT_DIRECTORIES;
