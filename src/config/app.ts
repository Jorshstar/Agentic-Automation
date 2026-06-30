import { runtimeConfig } from "./runtime.js";
import {
  NICHE_ROTATION_DAYS,
  OUTPUT_DIRECTORIES,
  SUPPORTED_NICHES,
  SUPPORTED_PLATFORMS,
  VIDEO_DURATION_SECONDS,
} from "./constants.js";

/**
 * Application configuration — the single object the rest of the app reads from.
 *
 * This file does NOT define new values; it only *composes* the pieces that
 * already exist (constants + runtime) into one tidy, strongly-typed shape. One
 * import (`appConfig`) gives any task everything it needs, while each concern
 * still lives in its own dedicated file.
 */
export const appConfig = {
  /** Environment-derived settings (environment, timezone, output dir). */
  runtime: runtimeConfig,
  /** Video output rules. */
  video: {
    durationSeconds: VIDEO_DURATION_SECONDS,
  },
  /** Niche rotation rules. */
  rotation: {
    daysPerNiche: NICHE_ROTATION_DAYS,
  },
  /** All supported niches and platforms. */
  niches: SUPPORTED_NICHES,
  platforms: SUPPORTED_PLATFORMS,
  /** Storage layout (sub-folder names). */
  directories: OUTPUT_DIRECTORIES,
} as const;

/** The shape of {@link appConfig}, for typing function signatures. */
export type AppConfig = typeof appConfig;
