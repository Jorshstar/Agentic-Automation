/**
 * Video — the rendered, final 60-second vertical video file.
 */
export interface Video {
  /** Where the video file lives (local path or remote URL). */
  readonly location: string;
  readonly durationSeconds: number;
  /** Pixel dimensions (e.g. 1080 x 1920 for vertical). */
  readonly width: number;
  readonly height: number;
  /** Container format, e.g. "mp4". */
  readonly format?: string;
  readonly sizeBytes?: number;
}
