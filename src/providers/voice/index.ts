/** Re-exports the voice provider contract, mock, and types. */
export type { VoiceProvider } from "./voice-provider.js";
export { MockVoiceProvider } from "./mock-voice-provider.js";
export type {
  VoiceGenerationRequest,
  VoiceGenerationResult,
  VoicePauseMarker,
  VoiceEmphasis,
  EstimateDurationRequest,
  EstimateDurationResult,
  VoiceValidation,
} from "./types.js";
