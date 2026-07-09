import type { VisualAssetType } from "../visual-direction/index.js";
import type { AssetProviderName } from "../asset-planning/index.js";
import type { AssetPlan } from "../asset-planning/index.js";

/**
 * Asset generation types — the request/response shapes an asset-generation
 * provider speaks.
 *
 * This stage LEAVES planning: it consumes an AssetPlan (which decided WHAT is
 * needed) and produces GeneratedAssets — the concrete media resources (or, at
 * this stage, a fully-specified production manifest describing them). It knows
 * NOTHING about FFmpeg, rendering, composition, or encoding. It only produces
 * media resources, and it stays provider-independent (Pexels, Flux, Runway, ...
 * are all swappable behind the same interface).
 */

/** How an asset is produced. */
export type AssetGenerationMethod =
  | "stock-download"
  | "ai-image"
  | "ai-video"
  | "motion-graphics"
  | "screen-recording"
  | "user-provided"
  | "local-file";

/** The lifecycle state of one asset. At this stage everything is "planned". */
export type AssetGenerationStatus =
  | "planned"
  | "generated"
  | "downloaded"
  | "skipped"
  | "failed";

/** All valid generation methods, for validation/coercion. */
export const ASSET_GENERATION_METHODS: readonly AssetGenerationMethod[] = [
  "stock-download",
  "ai-image",
  "ai-video",
  "motion-graphics",
  "screen-recording",
  "user-provided",
  "local-file",
];

/** All valid statuses, for validation/coercion. */
export const ASSET_GENERATION_STATUSES: readonly AssetGenerationStatus[] = [
  "planned",
  "generated",
  "downloaded",
  "skipped",
  "failed",
];

/** A structured, machine-readable warning (never a bare string). */
export type AssetGenerationWarningCode =
  | "parse-error"
  | "missing-field"
  | "unknown-provider"
  | "unknown-asset-type"
  | "unknown-method"
  | "unknown-status"
  | "count-mismatch"
  | "malformed-entry";

export interface AssetGenerationWarning {
  readonly code: AssetGenerationWarningCode;
  readonly message: string;
  /** The segment the warning relates to, when applicable. */
  readonly segmentId?: string;
}

/**
 * AssetProviderResult — the NORMALIZED result of sourcing one asset, as a real
 * provider adapter (Pexels, Flux, Runway, ...) would hand back. The Claude
 * provider parses the model's manifest into these, then enriches each into a
 * {@link GeneratedAsset}. This is the anti-corruption shape that keeps callers
 * independent of any specific provider's response format.
 */
export interface AssetProviderResult {
  readonly segmentId: string;
  readonly assetType: VisualAssetType;
  readonly provider: AssetProviderName;
  readonly fallbackProvider: AssetProviderName;
  readonly generationMethod: AssetGenerationMethod;
  /** A source reference (e.g. "pexels:query=..."), NOT a fabricated real URL. */
  readonly sourceUrl: string;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
  readonly durationSeconds: number;
  readonly license: string;
  readonly status: AssetGenerationStatus;
  readonly estimatedCostUsd: number;
  readonly notes: string;
}

/** Per-asset production metadata carried alongside the media fields. */
export interface GeneratedAssetMetadata {
  readonly status: AssetGenerationStatus;
  readonly primaryProvider: AssetProviderName;
  readonly fallbackProvider: AssetProviderName;
  readonly generationMethod: AssetGenerationMethod;
  readonly estimatedCostUsd: number;
  readonly notes: string;
}

/** One produced (here: planned) media resource for a scene/segment. */
export interface GeneratedAsset {
  readonly assetId: string;
  readonly sceneId: string;
  readonly segmentId: string;
  readonly assetType: VisualAssetType;
  readonly provider: AssetProviderName;
  /** Source reference the asset would be fetched/generated from. */
  readonly sourceUrl: string;
  /** Planned local path where the produced file would be saved. */
  readonly localPath: string;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
  readonly durationSeconds: number;
  /** Content checksum — empty until the file is actually produced. */
  readonly checksum: string;
  readonly license: string;
  readonly generationMethod: AssetGenerationMethod;
  readonly metadata: GeneratedAssetMetadata;
}

/** Tokens + timing + routing recorded for one asset-generation run. */
export interface AssetGenerationRunMetadata {
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
 * GeneratedAssets — the strongly-typed result of the asset-generation stage: the
 * produced media resources, structured warnings, and run metadata.
 */
export interface GeneratedAssets {
  readonly assets: readonly GeneratedAsset[];
  readonly warnings: readonly AssetGenerationWarning[];
  readonly metadata: AssetGenerationRunMetadata;
}

/** The fixed production context the AssetPlan doesn't carry (resolution, paths). */
export interface GeneratedAssetContext {
  readonly platform: string;
  readonly width: number;
  readonly height: number;
  /** Base directory the planned localPath is rooted at. */
  readonly assetRootDir: string;
}

/** What the caller asks the asset generator to produce. */
export interface GeneratedAssetRequest {
  readonly assetPlan: AssetPlan;
  /** Optional per-call overrides of the provider's default context. */
  readonly context?: Partial<GeneratedAssetContext>;
}
