/**
 * Music generation types — the request/response shapes the music stage speaks.
 *
 * This PRODUCTION stage is fully local (FFmpeg only — no AI, no network, no key).
 * It synthesizes a simple ambient bed matched to the niche's mood, sized to the
 * narration length, with a gentle fade in/out. Composition later ducks it under
 * the voice. Swappable later for a real music library or generation API without
 * changing callers.
 */

/** The ambient mood presets (mapped from each niche's musicMood). */
export type MusicMood =
  | "tense-drone"
  | "upbeat-electronic"
  | "warm-pad"
  | "emotive-score"
  | "neutral";

/** All valid moods, for validation. */
export const MUSIC_MOODS: readonly MusicMood[] = [
  "tense-drone",
  "upbeat-electronic",
  "warm-pad",
  "emotive-score",
  "neutral",
];

export type MusicFormat = "mp3" | "wav";

/** The fixed synthesis context (mood + audio settings). */
export interface MusicGenerationContext {
  readonly mood: MusicMood;
  readonly format: MusicFormat;
  /** Final linear level of the bed (0..1); Composition ducks it further. */
  readonly volume: number;
  readonly fadeSeconds: number;
  readonly sampleRate: number;
  readonly outputDir: string;
}

/** What the caller asks the music stage to produce. */
export interface MusicGenerationRequest {
  /** Target length in seconds (usually the measured voiceover total). */
  readonly durationSeconds: number;
  /**
   * Seed for the per-run variation (key transpose, tremolo/noise jitter) so no
   * two videos get an identical bed while keeping the mood. Omit for random.
   */
  readonly variationSeed?: number;
  /** Optional per-call overrides of the provider's default context. */
  readonly context?: Partial<MusicGenerationContext>;
}

/** A structured, machine-readable warning (never a bare string). */
export type MusicGenerationWarningCode = "invalid-duration" | "synthesis-failed" | "probe-failed";

export interface MusicGenerationWarning {
  readonly code: MusicGenerationWarningCode;
  readonly message: string;
}

/** The variation actually applied to this bed (for logs/reproducibility). */
export interface MusicVariation {
  readonly seed: number;
  /** Key transpose applied to the whole oscillator stack (-3..+3). */
  readonly semitones: number;
  /** Multiplier applied to the mood's tremolo rate (1 = unchanged). */
  readonly tremoloFactor: number;
}

/** Metadata recorded for one music-generation run. */
export interface MusicGenerationMetadata {
  readonly provider: string;
  readonly mood: MusicMood;
  readonly requestedDurationSeconds: number;
  readonly sampleRate: number;
  readonly variation: MusicVariation;
  readonly latencyMs: number;
}

/**
 * GeneratedMusic — the strongly-typed result: the written track (empty path if it
 * failed), measured duration, structured warnings, and metadata.
 */
export interface GeneratedMusic {
  /** Path to the written audio file, or "" if synthesis failed. */
  readonly musicPath: string;
  readonly mood: MusicMood;
  /** Measured duration in seconds (0 if unmeasurable/failed). */
  readonly durationSeconds: number;
  readonly format: MusicFormat;
  readonly bytes: number;
  readonly warnings: readonly MusicGenerationWarning[];
  readonly metadata: MusicGenerationMetadata;
}
