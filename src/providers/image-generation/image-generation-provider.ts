import type { ImageGenerationRequest, GeneratedImages } from "./types.js";

/**
 * ImageGenerationProvider — the CONTRACT for anything that turns an AssetPlan's
 * visual prompts into real image files ({@link GeneratedImages}).
 *
 * Callers depend only on this interface, never on a specific image model. Today an
 * OpenAI-backed implementation satisfies it; Flux/Runway/etc. could later, with no
 * change to callers. It produces image resources only — it knows nothing about
 * composition or rendering.
 */
export interface ImageGenerationProvider {
  /** Stable name for logs (e.g. "openai-image-generation-provider"). */
  readonly name: string;
  /** Generate one image per segment and write the files. */
  generate(request: ImageGenerationRequest): Promise<GeneratedImages>;
}
