import type { GeneratedAssetRequest, GeneratedAssets } from "./types.js";

/**
 * AssetGenerationProvider — the CONTRACT for anything that turns an AssetPlan
 * into {@link GeneratedAssets}.
 *
 * Callers depend only on this interface, never on a specific asset source. Today
 * a Claude-backed implementation produces the manifest; tomorrow real adapters
 * (Pexels, Flux, Runway, ...) can implement the same one method with no change to
 * callers. It produces media resources only — it knows nothing about rendering.
 */
export interface AssetGenerationProvider {
  /** Stable name for logs (e.g. "claude-asset-generation-provider"). */
  readonly name: string;
  /** Produce the media resources described by an asset plan. */
  generate(request: GeneratedAssetRequest): Promise<GeneratedAssets>;
}
