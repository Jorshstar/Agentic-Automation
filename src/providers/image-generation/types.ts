import type { AssetPlan } from "../asset-planning/index.js";

/**
 * Image generation types — the request/response shapes the image stage speaks.
 *
 * This PRODUCTION stage makes REAL pixels: it takes each segment's visual prompt
 * (already niche-styled), calls OpenAI Images (native `fetch`, no SDK), and writes
 * a real image file per segment. It does NOT go through the AI Kernel (that's for
 * Claude text) and knows nothing about composition/rendering — it only produces
 * image resources. Defensive: a failed image is a structured warning + skipped
 * file, not a crash.
 */

export type ImageFormat = "png" | "jpeg" | "webp";

/** Lifecycle state of one image. */
export type ImageStatus = "generated" | "failed";

/** The fixed generation context (niche style + model settings). */
export interface ImageGenerationContext {
  /** OpenAI image model (e.g. "dall-e-3", "gpt-image-1"). */
  readonly model: string;
  /** Requested size, e.g. "1024x1792" (portrait for shorts). */
  readonly size: string;
  /** Model quality tier (e.g. dall-e-3 "standard"/"hd"). */
  readonly quality: string;
  readonly format: ImageFormat;
  /** Niche style text appended to every prompt (visual identity). */
  readonly styleSuffix: string;
  readonly outputDir: string;
}

/** What the caller asks the image stage to generate. */
export interface ImageGenerationRequest {
  /** The asset plan whose per-segment `visualPrompt`s drive the images. */
  readonly assetPlan: AssetPlan;
  /** Optional per-call overrides of the provider's default context. */
  readonly context?: Partial<ImageGenerationContext>;
}

/** A structured, machine-readable warning (never a bare string). */
export type ImageGenerationWarningCode =
  | "empty-prompt"
  | "generation-failed"
  | "decode-failed"
  | "unexpected-response";

export interface ImageGenerationWarning {
  readonly code: ImageGenerationWarningCode;
  readonly message: string;
  readonly segmentId?: string;
}

/** One produced image for a segment. */
export interface GeneratedImage {
  readonly segmentId: string;
  readonly prompt: string;
  readonly imagePath: string;
  readonly status: ImageStatus;
  readonly model: string;
  readonly format: ImageFormat;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  /**
   * Optional real stock-video clip for this scene (the waterfall winner). When
   * set, composition builds the segment from this clip instead of the image;
   * `imagePath` may be "" in that case.
   */
  readonly videoPath?: string;
}

/** Provider/model/usage recorded for one image-generation run. */
export interface ImageGenerationMetadata {
  readonly provider: string;
  readonly model: string;
  readonly size: string;
  readonly quality: string;
  readonly requested: number;
  readonly generated: number;
  readonly totalBytes: number;
  readonly latencyMs: number;
}

/**
 * GeneratedImages — the strongly-typed result: the produced image files,
 * structured warnings, and run metadata.
 */
export interface GeneratedImages {
  readonly images: readonly GeneratedImage[];
  readonly outputDir: string;
  readonly warnings: readonly ImageGenerationWarning[];
  readonly metadata: ImageGenerationMetadata;
}
