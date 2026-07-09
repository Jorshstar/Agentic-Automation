import type { VisualAssetType } from "../visual-direction/index.js";
import type { VisualDirectionPlan } from "../visual-direction/index.js";

/**
 * Asset planning types — the request/response shapes an asset-planning provider
 * speaks.
 *
 * An AssetPlan is the SOURCING layer for the visual direction: for each segment
 * it recommends WHERE the asset comes from (primary + fallback provider) and HOW
 * to find or generate it (search queries or a generation prompt). It decides
 * nothing about actual files — it is the shared procurement brief that Storyboard
 * and Asset Generation build on. Nothing is downloaded or generated here.
 */

/**
 * The asset providers the plan can recommend. Future integrations — the plan only
 * NAMES a provider; it never calls one.
 */
export type AssetProviderName =
  | "pexels"
  | "pixabay"
  | "unsplash"
  | "runway"
  | "openai-images"
  | "google-veo"
  | "user-library"
  | "local-storage";

/** The fixed context the visual direction plan doesn't carry. */
export interface AssetPlanContext {
  readonly platform: string;
  readonly targetDurationSeconds: number;
}

/** What the caller asks the asset planner to turn into a plan. */
export interface AssetPlanRequest {
  /** The visual direction this sourcing plan must align to. */
  readonly visualDirection: VisualDirectionPlan;
  /** Optional per-call overrides of the provider's default context. */
  readonly context?: Partial<AssetPlanContext>;
}

/** The recommended sourcing plan for one visual segment. */
export interface AssetPlanSegment {
  /** Ties back to the visual/narration segment (e.g. "seg-1"). */
  readonly segmentId: string;
  readonly assetType: VisualAssetType;
  readonly primaryProvider: AssetProviderName;
  readonly fallbackProvider: AssetProviderName;
  /** Short stock-search phrases (most useful for stock providers). */
  readonly searchQueries: readonly string[];
  /** A detailed generation prompt (most useful for AI image/video). */
  readonly visualPrompt: string;
  /** Best-guess clip/asset length in seconds. */
  readonly estimatedDuration: number;
  /** Short licensing note (e.g. "royalty-free", "commercial use OK"). */
  readonly licenseRequirements: string;
  readonly notes: string;
}

/** Tokens + timing + routing recorded for one asset-plan generation. */
export interface AssetPlanMetadata {
  readonly promptId: string;
  readonly promptVersion: string;
  readonly provider: string;
  readonly model: string;
  readonly tokenUsage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
  };
  readonly latencyMs: number;
}

/**
 * AssetPlan — the strongly-typed sourcing plan.
 *
 * `warnings` records anything the parser had to fall back on (missing fields,
 * unknown providers, count mismatch vs the visual direction), so a broken plan is
 * never silently accepted. `metadata` carries token usage / latency.
 */
export interface AssetPlan {
  readonly segments: readonly AssetPlanSegment[];
  readonly warnings: readonly string[];
  readonly metadata: AssetPlanMetadata;
}

/** All valid asset providers, for validation/coercion. */
export const ASSET_PROVIDERS: readonly AssetProviderName[] = [
  "pexels",
  "pixabay",
  "unsplash",
  "runway",
  "openai-images",
  "google-veo",
  "user-library",
  "local-storage",
];
