/**
 * Voice provider types — the request/response shapes a voice provider speaks.
 *
 * This stage produces METADATA ONLY (voice direction): what to say, in what
 * voice/style, where to pause/emphasise, and how long it should take. No audio
 * is generated, no files are written, no network is used.
 */

export interface VoiceGenerationRequest {
  /** The narration text to be spoken (usually the script body). */
  readonly script: string;
  readonly title?: string;
  readonly language?: string;
  /** Desired delivery style, e.g. "energetic-explainer". */
  readonly tone?: string;
  /** Desired video length in seconds (e.g. 60). */
  readonly targetDurationSeconds?: number;
}

/** A pause direction within the narration. */
export interface VoicePauseMarker {
  readonly afterWordIndex: number;
  readonly durationMs: number;
}

/** An emphasis direction within the narration. */
export interface VoiceEmphasis {
  readonly text: string;
  readonly level: "light" | "strong";
}

/** The full voice direction returned by a provider (metadata only). */
export interface VoiceGenerationResult {
  readonly narrationText: string;
  readonly speaker: string;
  readonly voiceId: string;
  readonly language: string;
  readonly speakingStyle: string;
  readonly speed: number;
  readonly durationSeconds: number;
  readonly estimatedAudioLengthSeconds: number;
  readonly pronunciationNotes: readonly string[];
  readonly pauses: readonly VoicePauseMarker[];
  readonly emphasisMarkers: readonly VoiceEmphasis[];
}

export interface EstimateDurationRequest {
  readonly text: string;
  /** Speaking-rate multiplier (1 = normal). */
  readonly speed?: number;
}
export interface EstimateDurationResult {
  readonly seconds: number;
}

export interface VoiceValidation {
  readonly valid: boolean;
  readonly issues: readonly string[];
}
