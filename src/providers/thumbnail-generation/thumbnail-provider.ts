import type { ThumbnailRequest, GeneratedThumbnail } from "./types.js";

/**
 * ThumbnailProvider — the CONTRACT for anything that produces cover images
 * ({@link GeneratedThumbnail}) for a finished video.
 *
 * Callers depend only on this interface. Today an FFmpeg text-burn implementation
 * satisfies it; a dedicated AI-generated-cover version could later, with no
 * change to callers.
 */
export interface ThumbnailProvider {
  /** Stable name for logs (e.g. "ffmpeg-thumbnail-provider"). */
  readonly name: string;
  /** Render the vertical + wide covers. Never throws — warns and degrades. */
  generate(request: ThumbnailRequest): Promise<GeneratedThumbnail>;
}
