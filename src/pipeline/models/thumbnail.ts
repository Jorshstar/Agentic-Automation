/**
 * Thumbnail — the cover image shown before the video plays.
 */
export interface Thumbnail {
  /** Where the image lives (local path or remote URL). */
  readonly location: string;
  readonly width?: number;
  readonly height?: number;
}
