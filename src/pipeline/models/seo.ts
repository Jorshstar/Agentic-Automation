import type { Platform } from "../../types/index.js";

/**
 * SeoMetadata — the upload details (title, description, tags) for the platforms.
 */
export interface SeoMetadata {
  readonly title: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly hashtags: readonly string[];
  /** Platforms this metadata is tuned for. */
  readonly platforms: readonly Platform[];
}
