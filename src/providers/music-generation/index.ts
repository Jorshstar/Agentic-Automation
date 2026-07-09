/** Re-exports the music-generation provider contract, real provider, and types. */
export type { MusicGenerationProvider } from "./music-generation-provider.js";
export { FfmpegMusicProvider } from "./ffmpeg-music-provider.js";
export type {
  MusicMood,
  MusicFormat,
  MusicGenerationContext,
  MusicGenerationRequest,
  MusicGenerationWarning,
  MusicGenerationWarningCode,
  MusicVariation,
  MusicGenerationMetadata,
  GeneratedMusic,
} from "./types.js";
export { MUSIC_MOODS } from "./types.js";
