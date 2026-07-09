import type { VoiceGenerationRequest, GeneratedVoiceover } from "./types.js";

/**
 * VoiceGenerationProvider — the CONTRACT for anything that turns a NarrativeScript
 * into real narration audio ({@link GeneratedVoiceover}).
 *
 * Callers depend only on this interface, never on a specific TTS service. Today an
 * OpenAI-backed implementation satisfies it; ElevenLabs/Azure/etc. could later,
 * with no change to callers. It produces audio only — it knows nothing about
 * captions, music, or composition.
 */
export interface VoiceGenerationProvider {
  /** Stable name for logs (e.g. "openai-voice-generation-provider"). */
  readonly name: string;
  /** Synthesize per-segment audio and return the measured voiceover. */
  generate(request: VoiceGenerationRequest): Promise<GeneratedVoiceover>;
}
