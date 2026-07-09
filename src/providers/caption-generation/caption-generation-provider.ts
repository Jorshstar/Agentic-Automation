import type { CaptionGenerationRequest, GeneratedCaptions } from "./types.js";

/**
 * CaptionGenerationProvider — the CONTRACT for anything that turns a measured
 * voiceover into a subtitle track ({@link GeneratedCaptions}).
 *
 * Callers depend only on this interface. Today a local subtitle builder satisfies
 * it; a word-level/forced-alignment implementation could later, with no change to
 * callers.
 */
export interface CaptionGenerationProvider {
  /** Stable name for logs (e.g. "subtitle-caption-provider"). */
  readonly name: string;
  /** Build subtitle cues + files from the voiceover timeline. */
  generate(request: CaptionGenerationRequest): Promise<GeneratedCaptions>;
}
