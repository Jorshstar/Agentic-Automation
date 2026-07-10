import type { NicheProfile } from "./niche-profiles.js";
import type { ResearchContext } from "../providers/research/index.js";
import type { ContentPlanContext } from "../providers/content-planning/index.js";
import type { NarrativeContext } from "../providers/narrative/index.js";
import type { VisualDirectionContext } from "../providers/visual-direction/index.js";
import type { AssetPlanContext } from "../providers/asset-planning/index.js";
import type { ScenePlanContext } from "../providers/scene-planning/index.js";
import type { GeneratedAssetContext } from "../providers/asset-generation/index.js";
import type { AudioFormat, VoiceGenerationContext } from "../providers/voice-generation/index.js";
import type { CaptionContext } from "../providers/caption-generation/index.js";
import type { ImageGenerationContext } from "../providers/image-generation/index.js";
import type { MusicGenerationContext } from "../providers/music-generation/index.js";
import type { CompositionContext } from "../providers/composition/index.js";
import type { QaContext } from "../providers/quality-assurance/index.js";
import type { ThumbnailContext } from "../providers/thumbnail-generation/index.js";
import type { StockVideoContext } from "../providers/stock-video/index.js";
import type { Niche } from "../types/index.js";

/**
 * Niche context builders — the mapping layer that makes the studio dynamic.
 *
 * Each function turns ONE {@link NicheProfile} (+ per-run settings) into the exact
 * context a provider expects. The pipeline calls these instead of relying on each
 * provider's hardcoded default, so `niche` drives the whole run. Pure functions —
 * no state, no side effects, trivial to test.
 */

/** Per-RUN settings that aren't part of a niche's identity (chosen at run time). */
export interface RunSettings {
  /** Human platform label used in prompts (e.g. "YouTube Shorts"). */
  readonly platformLabel: string;
  readonly targetDurationSeconds: number;
  readonly width: number;
  readonly height: number;
  readonly voiceModel: string;
  readonly voiceFormat: AudioFormat;
  readonly voiceSpeed: number;
  readonly voiceOutputDir: string;
  readonly assetRootDir: string;
  readonly captionOutputDir: string;
  readonly imageModel: string;
  readonly imageSize: string;
  readonly imageQuality: string;
  readonly imageOutputDir: string;
  readonly musicOutputDir: string;
  readonly fps: number;
  readonly videoOutputDir: string;
  readonly thumbnailOutputDir: string;
  readonly stockOutputDir: string;
  /** Use real stock footage (Pexels/Pixabay) as the per-scene visual when a good
   *  vertical clip exists; falls back to the AI image otherwise. */
  readonly useStockVideo: boolean;
}

/** Sensible defaults: 60s vertical 1080x1920 YouTube Short, current cheap TTS model. */
export const DEFAULT_RUN_SETTINGS: RunSettings = {
  platformLabel: "YouTube Shorts",
  targetDurationSeconds: 65,
  width: 1080,
  height: 1920,
  voiceModel: "gpt-4o-mini-tts",
  voiceFormat: "mp3",
  voiceSpeed: 1.0,
  voiceOutputDir: "output/voice",
  assetRootDir: "output/assets",
  captionOutputDir: "output/captions",
  imageModel: "gpt-image-1",
  imageSize: "1024x1536",
  imageQuality: "medium",
  imageOutputDir: "output/assets/images",
  musicOutputDir: "output/music",
  fps: 30,
  videoOutputDir: "output/video",
  thumbnailOutputDir: "output/thumbnails",
  stockOutputDir: "output/stock",
  // On by default — free, and it only REPLACES a scene when a good clip exists,
  // otherwise the AI image is used. No key set → silently all-images (no cost).
  useStockVideo: true,
};


export function buildResearchContext(
  profile: NicheProfile,
  run: RunSettings = DEFAULT_RUN_SETTINGS,
): ResearchContext {
  return {
    audience: profile.audience,
    tone: profile.tone,
    language: profile.language,
    platform: run.platformLabel,
  };
}

export function buildContentPlanContext(
  profile: NicheProfile,
  run: RunSettings = DEFAULT_RUN_SETTINGS,
): ContentPlanContext {
  return {
    audience: profile.audience,
    tone: profile.tone,
    language: profile.language,
    platform: run.platformLabel,
    targetDurationSeconds: run.targetDurationSeconds,
  };
}

export function buildNarrativeContext(
  _profile: NicheProfile,
  run: RunSettings = DEFAULT_RUN_SETTINGS,
): NarrativeContext {
  return {
    language: _profile.language,
    platform: run.platformLabel,
    targetDurationSeconds: run.targetDurationSeconds,
    // Scary stories are TRUE historical horror — a narrator persona that opens on
    // a verified shocking fact and is forbidden from inventing anything.
    ...(_profile.niche === "scary-stories" ? { systemPromptId: "narrative-scary.system" } : {}),
  };
}

export function buildVisualDirectionContext(
  profile: NicheProfile,
  run: RunSettings = DEFAULT_RUN_SETTINGS,
): VisualDirectionContext {
  return {
    platform: run.platformLabel,
    overallVisualStyle: `${profile.visualStyle}. Colour mood: ${profile.colorMood}.`,
  };
}

export function buildAssetPlanContext(
  _profile: NicheProfile,
  run: RunSettings = DEFAULT_RUN_SETTINGS,
): AssetPlanContext {
  return {
    platform: run.platformLabel,
    targetDurationSeconds: run.targetDurationSeconds,
  };
}

export function buildScenePlanContext(
  _profile: NicheProfile,
  run: RunSettings = DEFAULT_RUN_SETTINGS,
): ScenePlanContext {
  return { platform: run.platformLabel };
}

export function buildAssetGenerationContext(
  _profile: NicheProfile,
  run: RunSettings = DEFAULT_RUN_SETTINGS,
): GeneratedAssetContext {
  return {
    platform: run.platformLabel,
    width: run.width,
    height: run.height,
    assetRootDir: run.assetRootDir,
  };
}

export function buildVoiceGenerationContext(
  profile: NicheProfile,
  run: RunSettings = DEFAULT_RUN_SETTINGS,
): VoiceGenerationContext {
  return {
    voice: profile.voice,
    model: run.voiceModel,
    format: run.voiceFormat,
    speed: run.voiceSpeed,
    outputDir: run.voiceOutputDir,
    instructions: profile.voiceInstructions,
  };
}

export function buildCaptionContext(
  profile: NicheProfile,
  run: RunSettings = DEFAULT_RUN_SETTINGS,
): CaptionContext {
  return {
    outputDir: run.captionOutputDir,
    width: run.width,
    height: run.height,
    fontName: profile.captionFont,
    accentColor: profile.captionAccent,
    // USER RULE: subtitles always sit at the BOTTOM, whatever an identity says
    // (the AI designer once picked "center" and it read badly mid-frame).
    position: "bottom",
    karaoke: profile.captionKaraoke,
  };
}

export function buildImageGenerationContext(
  profile: NicheProfile,
  run: RunSettings = DEFAULT_RUN_SETTINGS,
): ImageGenerationContext {
  return {
    model: run.imageModel,
    size: run.imageSize,
    quality: run.imageQuality,
    format: "png",
    styleSuffix:
      `Art direction: ${profile.visualStyle}. Colour mood: ${profile.colorMood}. ` +
      "Vertical 9:16 composition, cinematic, high detail, no text or letters in the image.",
    outputDir: run.imageOutputDir,
  };
}

export function buildMusicGenerationContext(
  profile: NicheProfile,
  run: RunSettings = DEFAULT_RUN_SETTINGS,
): MusicGenerationContext {
  return {
    mood: profile.musicPreset,
    format: "mp3",
    volume: 1.0,
    fadeSeconds: 1.5,
    sampleRate: 44_100,
    outputDir: run.musicOutputDir,
  };
}

export function buildCompositionContext(
  profile: NicheProfile,
  run: RunSettings = DEFAULT_RUN_SETTINGS,
): CompositionContext {
  return {
    width: run.width,
    height: run.height,
    fps: run.fps,
    outputPath: `${run.videoOutputDir}/${profile.niche}.mp4`,
    workDir: `${run.videoOutputDir}/work/${profile.niche}`,
    musicVolume: 0.15,
    kenBurns: true,
  };
}

export function buildStockVideoContext(
  run: RunSettings = DEFAULT_RUN_SETTINGS,
): StockVideoContext {
  return {
    width: run.width,
    height: run.height,
    minDurationSeconds: 4,
    outputDir: run.stockOutputDir,
  };
}

export function buildThumbnailContext(
  profile: NicheProfile,
  run: RunSettings = DEFAULT_RUN_SETTINGS,
): ThumbnailContext {
  return {
    width: run.width,
    height: run.height,
    wideWidth: 1280,
    wideHeight: 720,
    fontName: "Arial",
    accentColor: profile.captionAccent,
    outputDir: run.thumbnailOutputDir,
  };
}

/** QA expectations (not niche-specific — driven by resolution + narration length). */
export function buildQaContext(
  run: RunSettings = DEFAULT_RUN_SETTINGS,
  expectedDurationSeconds?: number,
): QaContext {
  return {
    expectedWidth: run.width,
    expectedHeight: run.height,
    ...(expectedDurationSeconds !== undefined ? { expectedDurationSeconds } : {}),
    durationTolerance: 0.15,
    // Platform window derived from the run's target so briefs with any duration
    // work (65s target → 60/72, matching the user's Shorts rule; a 90s brief →
    // 83/100). Violations BLOCK delivery.
    minDurationSeconds: Math.round(run.targetDurationSeconds * 0.92),
    maxDurationSeconds: Math.round(run.targetDurationSeconds * 1.11),
    requireAudio: true,
    minSizeBytes: 50_000,
  };
}
