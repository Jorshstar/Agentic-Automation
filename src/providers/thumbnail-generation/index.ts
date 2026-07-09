/** Re-exports the thumbnail provider contract, real provider, and types. */
export type { ThumbnailProvider } from "./thumbnail-provider.js";
export { FfmpegThumbnailProvider } from "./ffmpeg-thumbnail-provider.js";
export type {
  ThumbnailContext,
  ThumbnailRequest,
  ThumbnailWarning,
  ThumbnailWarningCode,
  ThumbnailMetadata,
  GeneratedThumbnail,
} from "./types.js";
