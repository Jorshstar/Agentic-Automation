/**
 * Thumbnail types — the request/response shapes the cover-image stage speaks.
 *
 * This PRODUCTION stage is fully local (FFmpeg only — no AI, no network, no
 * cost). It takes an already-generated scene image (normally the hook scene) and
 * burns big bold cover text onto it (niche accent styling, our proven ASS/libass
 * path), producing two covers:
 *   - thumbnail.jpg       vertical  (e.g. 1080x1920 — TikTok / Reels / FB covers)
 *   - thumbnail-wide.jpg  16:9      (e.g. 1280x720  — YouTube)
 */

/** Styling + layout for the covers (accent is niche-driven). */
export interface ThumbnailContext {
  readonly width: number;
  readonly height: number;
  readonly wideWidth: number;
  readonly wideHeight: number;
  readonly fontName: string;
  /** Accent colour, hex "#RRGGBB" (used for the text glow/shadow). */
  readonly accentColor: string;
  readonly outputDir: string;
}

/** What the caller asks the thumbnail stage to build. */
export interface ThumbnailRequest {
  /** Source image (normally the hook scene's PNG). */
  readonly imagePath: string;
  /** Cover text (2-4 words; rendered ALL CAPS). */
  readonly text: string;
  /** Optional per-call overrides of the provider's default context. */
  readonly context?: Partial<ThumbnailContext>;
}

/** A structured, machine-readable warning (never a bare string). */
export type ThumbnailWarningCode = "missing-image" | "empty-text" | "render-failed";

export interface ThumbnailWarning {
  readonly code: ThumbnailWarningCode;
  readonly message: string;
}

/** Metadata recorded for one thumbnail render. */
export interface ThumbnailMetadata {
  readonly provider: string;
  readonly sourceImage: string;
  readonly latencyMs: number;
}

/**
 * GeneratedThumbnail — the strongly-typed result. Paths are "" when a render
 * failed (with a warning) — a missing cover never blocks a finished video.
 */
export interface GeneratedThumbnail {
  /** Vertical cover (or "" if it failed). */
  readonly thumbnailPath: string;
  /** 16:9 cover (or "" if it failed). */
  readonly wideThumbnailPath: string;
  /** The text actually burned (ALL CAPS). */
  readonly text: string;
  readonly warnings: readonly ThumbnailWarning[];
  readonly metadata: ThumbnailMetadata;
}
