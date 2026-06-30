import type {
  VoiceGenerationRequest,
  VoiceGenerationResult,
  EstimateDurationRequest,
  EstimateDurationResult,
  VoiceValidation,
} from "./types.js";

/**
 * VoiceProvider — the CONTRACT for anything that can produce voice direction.
 *
 * The VoiceAgent talks only to this interface, never to a specific TTS service
 * (ElevenLabs, OpenAI TTS, ...). At this stage it returns METADATA only.
 */
export interface VoiceProvider {
  readonly name: string;
  /** Produce full voice direction (metadata) for a piece of narration. */
  generateVoiceover(request: VoiceGenerationRequest): Promise<VoiceGenerationResult>;
  /** Estimate how long narration will take to speak. */
  estimateDuration(request: EstimateDurationRequest): Promise<EstimateDurationResult>;
  /** Check the narration is usable before generating direction. */
  validateNarration(text: string): Promise<VoiceValidation>;
}
