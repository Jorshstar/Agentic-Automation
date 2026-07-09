/** Re-exports the composition provider contract, real provider, and types. */
export type { CompositionProvider } from "./composition-provider.js";
export { FfmpegCompositionProvider } from "./ffmpeg-composition-provider.js";
export type {
  CompositionContext,
  CompositionRequest,
  CompositionWarning,
  CompositionWarningCode,
  CompositionMetadata,
  GeneratedVideo,
} from "./types.js";
