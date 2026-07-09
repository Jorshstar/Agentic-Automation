import type { MusicGenerationRequest, GeneratedMusic } from "./types.js";

/**
 * MusicGenerationProvider — the CONTRACT for anything that produces a background
 * music bed ({@link GeneratedMusic}).
 *
 * Callers depend only on this interface. Today an FFmpeg synthesizer satisfies it;
 * a music library or generation API could later, with no change to callers.
 */
export interface MusicGenerationProvider {
  /** Stable name for logs (e.g. "ffmpeg-music-provider"). */
  readonly name: string;
  /** Produce a music bed of the requested length. */
  generate(request: MusicGenerationRequest): Promise<GeneratedMusic>;
}
