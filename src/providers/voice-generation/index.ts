/** Re-exports the voice-generation provider contract, real provider, and types. */
export type { VoiceGenerationProvider } from "./voice-generation-provider.js";
export { OpenAIVoiceGenerationProvider } from "./openai-voice-generation-provider.js";
export type {
  AudioFormat,
  VoiceGenerationContext,
  VoiceGenerationRequest,
  VoiceGenerationWarning,
  VoiceGenerationWarningCode,
  GeneratedVoiceSegment,
  VoiceGenerationMetadata,
  GeneratedVoiceover,
} from "./types.js";
