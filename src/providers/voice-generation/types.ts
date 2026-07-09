import type { NarrativeScript } from "../narrative/index.js";

/**
 * Voice generation types — the request/response shapes the voice-generation
 * provider speaks.
 *
 * This is a PRODUCTION stage: it consumes the timed NarrativeScript and produces
 * REAL audio files (one per segment) via a text-to-speech service, then measures
 * each with ffprobe to build the ACTUAL timeline. That measured timeline — not
 * the planned one — becomes the source of truth every later stage (captions,
 * composition) syncs to, because synthesized speech rarely matches the estimate
 * exactly. It knows nothing about rendering or composition.
 */

/** Audio container/codec for the synthesized speech (OpenAI-supported set). */
export type AudioFormat = "mp3" | "wav" | "opus" | "aac" | "flac";

/** The fixed synthesis context the NarrativeScript doesn't carry. */
export interface VoiceGenerationContext {
  /** TTS voice id (e.g. OpenAI "alloy", "nova", "onyx"). */
  readonly voice: string;
  /** TTS model (e.g. "gpt-4o-mini-tts", "tts-1"). */
  readonly model: string;
  readonly format: AudioFormat;
  /** Speaking-rate multiplier (1 = normal). */
  readonly speed: number;
  /** Directory the per-segment audio files are written to. */
  readonly outputDir: string;
  /**
   * Optional delivery-style instructions (niche voice identity), sent to
   * gpt-4o-mini-tts's `instructions` field — e.g. "Deep, slow, ominous, dry dark
   * humor." Ignored by models that don't support it (e.g. tts-1).
   */
  readonly instructions?: string;
}

/** What the caller asks the voice generator to synthesize. */
export interface VoiceGenerationRequest {
  readonly narrative: NarrativeScript;
  /** Optional per-call overrides of the provider's default context. */
  readonly context?: Partial<VoiceGenerationContext>;
}

/** A structured, machine-readable warning (never a bare string). */
export type VoiceGenerationWarningCode =
  | "empty-segment"
  | "synthesis-failed"
  | "probe-failed"
  | "duration-drift";

export interface VoiceGenerationWarning {
  readonly code: VoiceGenerationWarningCode;
  readonly message: string;
  readonly segmentId?: string;
}

/** One synthesized narration segment, with planned vs. measured timing. */
export interface GeneratedVoiceSegment {
  readonly segmentId: string;
  readonly text: string;
  /** Absolute/relative path to the written audio file. */
  readonly audioPath: string;
  readonly format: AudioFormat;
  readonly voice: string;
  /** Timing the plan asked for (from the NarrativeScript). */
  readonly plannedStartSecond: number;
  readonly plannedEndSecond: number;
  /** Timing actually produced (cumulative from measured durations). */
  readonly actualStartSecond: number;
  readonly actualEndSecond: number;
  readonly actualDurationSeconds: number;
  readonly characterCount: number;
}

/** Provider/model/usage recorded for one voice-generation run. */
export interface VoiceGenerationMetadata {
  readonly provider: string;
  readonly model: string;
  readonly voice: string;
  readonly format: AudioFormat;
  readonly segmentCount: number;
  readonly totalCharacters: number;
  readonly latencyMs: number;
}

/**
 * GeneratedVoiceover — the strongly-typed result of the voice stage: the
 * per-segment audio, the real total duration, structured warnings, and metadata.
 */
export interface GeneratedVoiceover {
  readonly segments: readonly GeneratedVoiceSegment[];
  /** Sum of the measured segment durations — the real video length driver. */
  readonly totalDurationSeconds: number;
  readonly outputDir: string;
  readonly warnings: readonly VoiceGenerationWarning[];
  readonly metadata: VoiceGenerationMetadata;
}
