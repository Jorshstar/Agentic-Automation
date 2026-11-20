import type { GeneratedVoiceover } from "../voice-generation/index.js";
import type { GeneratedImages } from "../image-generation/index.js";
import type { GeneratedCaptions } from "../caption-generation/index.js";
import type { GeneratedMusic } from "../music-generation/index.js";

/**
 * Composition types — the request/response shapes the composition stage speaks.
 *
 * This PRODUCTION stage assembles the finished video. It consumes the outputs of
 * the earlier stages (voice, images, captions, music) and drives FFmpeg to render
 * a single MP4: per-segment image clips with a gentle Ken-Burns pan, the
 * concatenated narration, ducked music, and burned-in captions. It is the ONLY
 * stage that knows FFmpeg composition — everything upstream stays render-agnostic.
 */

export interface CompositionContext {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  /** Final MP4 path, e.g. "output/video/scary-stories.mp4". */
  readonly outputPath: string;
  /** Directory for intermediate per-segment clips + concat lists. */
  readonly workDir: string;
  /** Music level under the voice (linear); voice stays at full. */
  readonly musicVolume: number;
  /** Apply the Ken-Burns pan to image clips. */
  readonly kenBurns: boolean;
  /**
   * Integrated loudness target in LUFS.
   *
   * -16 suits a narration-plus-music mix, where the voice has to leave room for
   * the bed. A voice-only video normalised to -16 just sounds quiet next to
   * everything else in a feed: YouTube, Spotify and the rest normalise around
   * -14, so that is what a track carrying only narration should hit.
   */
  readonly loudnessTargetLufs?: number;
}

export interface CompositionRequest {
  /** The measured narration — this defines the master timeline. */
  readonly voiceover: GeneratedVoiceover;
  /** Per-segment images (matched by segmentId; missing → colour fallback). */
  readonly images: GeneratedImages;
  /** Optional burned-in captions (the .ass track). */
  readonly captions?: GeneratedCaptions;
  /** Optional background music bed. */
  readonly music?: GeneratedMusic;
  readonly context?: Partial<CompositionContext>;
}

/** A structured, machine-readable warning (never a bare string). */
export type CompositionWarningCode =
  | "missing-audio"
  | "missing-image"
  | "clip-failed"
  | "voice-concat-failed"
  | "captions-skipped"
  | "render-failed"
  | "probe-failed";

export interface CompositionWarning {
  readonly code: CompositionWarningCode;
  readonly message: string;
  readonly segmentId?: string;
}

export interface CompositionMetadata {
  readonly provider: string;
  readonly segmentCount: number;
  readonly clipCount: number;
  readonly renderMs: number;
  readonly sizeBytes: number;
}

/**
 * GeneratedVideo — the strongly-typed result: the rendered MP4 (empty path if the
 * render failed), what made it in, structured warnings, and metadata.
 */
export interface GeneratedVideo {
  /** Path to the rendered MP4, or "" if the render failed. */
  readonly videoPath: string;
  readonly durationSeconds: number;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly hasAudio: boolean;
  readonly hasCaptions: boolean;
  readonly hasMusic: boolean;
  readonly warnings: readonly CompositionWarning[];
  readonly metadata: CompositionMetadata;
}
