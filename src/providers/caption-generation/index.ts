/** Re-exports the caption-generation provider contract, real provider, and types. */
export type { CaptionGenerationProvider } from "./caption-generation-provider.js";
export { SubtitleCaptionProvider } from "./subtitle-caption-provider.js";
export type {
  CaptionPosition,
  CaptionContext,
  CaptionGenerationRequest,
  CaptionCue,
  CaptionGenerationWarning,
  CaptionGenerationWarningCode,
  CaptionGenerationMetadata,
  GeneratedCaptions,
} from "./types.js";
