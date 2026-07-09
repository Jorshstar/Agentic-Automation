import type { CompositionRequest, GeneratedVideo } from "./types.js";

/**
 * CompositionProvider — the CONTRACT for anything that renders the final video
 * ({@link GeneratedVideo}) from the produced media.
 *
 * Callers depend only on this interface. Today an FFmpeg implementation satisfies
 * it; a different renderer could later, with no change to callers.
 */
export interface CompositionProvider {
  /** Stable name for logs (e.g. "ffmpeg-composition-provider"). */
  readonly name: string;
  /** Assemble voice + images + captions + music into one MP4. */
  compose(request: CompositionRequest): Promise<GeneratedVideo>;
}
