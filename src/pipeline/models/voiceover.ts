/**
 * Voiceover — the voice direction + (later) the spoken-audio track.
 *
 * The Voiceover agent fills in the DIRECTION metadata (what to say, in what voice
 * and style, where to pause/emphasise). The actual rendered audio fields
 * (`audioLocation`, `format`) stay empty until a future render step exists — so
 * `audioLocation` is optional. `durationSeconds` holds the estimated spoken
 * length at this stage.
 */

/** Where to insert a pause in the narration. */
export interface VoicePause {
  /** Insert the pause after this word index (0-based). */
  readonly afterWordIndex: number;
  readonly durationMs: number;
}

/** A word/phrase to emphasise during narration. */
export interface VoiceEmphasisMarker {
  readonly text: string;
  readonly level: "light" | "strong";
}

export interface Voiceover {
  // ----- Voice direction (produced by the Voiceover agent) -----
  /** The exact text to be spoken. */
  readonly narrationText?: string;
  /** Human-friendly speaker/persona name. */
  readonly speaker?: string;
  /** Provider voice identifier. */
  readonly voiceId?: string;
  /** BCP-47 language tag, e.g. "en-US". */
  readonly language?: string;
  /** Delivery style, e.g. "energetic-explainer". */
  readonly speakingStyle?: string;
  /** Speaking-rate multiplier (1 = normal). */
  readonly speed?: number;
  /** Words needing special pronunciation guidance. */
  readonly pronunciationNotes?: readonly string[];
  /** Where to pause during narration. */
  readonly pauses?: readonly VoicePause[];
  /** Words/phrases to emphasise. */
  readonly emphasisMarkers?: readonly VoiceEmphasisMarker[];
  /** Estimated spoken length, in seconds. */
  readonly estimatedAudioLengthSeconds?: number;

  // ----- Rendered audio (filled by a future render step) -----
  /** Estimated/known duration, in seconds. */
  readonly durationSeconds?: number;
  /** Where the rendered audio lives, once it exists (local path or URL). */
  readonly audioLocation?: string;
  /** Audio format, e.g. "mp3". */
  readonly format?: string;
}
