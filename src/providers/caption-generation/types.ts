import type { GeneratedVoiceover } from "../voice-generation/index.js";

/**
 * Caption generation types — the request/response shapes the caption stage speaks.
 *
 * This PRODUCTION stage is fully local (no AI, no network, no key). It reads the
 * voice stage's MEASURED timeline (the real per-segment start/end + text), splits
 * each segment into short readable cues, and writes subtitle files: a portable
 * `.srt` and a styled `.ass` (for burned-in captions). It knows nothing about
 * rendering — Composition later burns the `.ass` onto the video.
 */

/** Where captions sit on screen. */
export type CaptionPosition = "bottom" | "center";

/** Styling + layout for the generated subtitles (niche-driven accent). */
export interface CaptionContext {
  readonly outputDir: string;
  readonly width: number;
  readonly height: number;
  readonly fontName: string;
  /** Accent colour, hex "#RRGGBB" (used for the caption glow/shadow). */
  readonly accentColor: string;
  readonly position: CaptionPosition;
  /**
   * Karaoke highlight: the whole sentence stays on screen, and each word turns
   * the accent colour as it is spoken (ASS `\k` timing, estimated per word).
   * The `.srt` stays plain either way.
   */
  readonly karaoke: boolean;
}

/** What the caller asks the caption stage to build. */
export interface CaptionGenerationRequest {
  /** The measured voiceover this subtitle track must sync to. */
  readonly voiceover: GeneratedVoiceover;
  /** Optional per-call overrides of the provider's default context. */
  readonly context?: Partial<CaptionContext>;
}

/** One subtitle cue on the timeline. */
export interface CaptionCue {
  readonly index: number;
  readonly segmentId: string;
  readonly startSecond: number;
  readonly endSecond: number;
  readonly text: string;
}

/** A structured, machine-readable warning (never a bare string). */
export type CaptionGenerationWarningCode = "empty-segment" | "empty-cue" | "zero-duration";

export interface CaptionGenerationWarning {
  readonly code: CaptionGenerationWarningCode;
  readonly message: string;
  readonly segmentId?: string;
}

/** Metadata recorded for one caption-generation run. */
export interface CaptionGenerationMetadata {
  readonly provider: string;
  readonly cueCount: number;
  readonly segmentCount: number;
  readonly fontName: string;
  readonly accentColor: string;
  readonly formats: readonly string[];
}

/**
 * GeneratedCaptions — the strongly-typed result: the cues, the written subtitle
 * files, structured warnings, and metadata.
 */
export interface GeneratedCaptions {
  readonly cues: readonly CaptionCue[];
  readonly srtPath: string;
  readonly assPath: string;
  readonly outputDir: string;
  readonly totalDurationSeconds: number;
  readonly warnings: readonly CaptionGenerationWarning[];
  readonly metadata: CaptionGenerationMetadata;
}
