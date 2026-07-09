import type { NarrativeScript } from "../narrative/index.js";

/**
 * Visual direction types — the request/response shapes a visual-direction
 * provider speaks.
 *
 * A VisualDirectionPlan is the ART-DIRECTION layer for the narration timeline:
 * for each spoken segment it RECOMMENDS how the shot should look and where the
 * asset should come from. It decides nothing about specific files — it is the
 * shared creative brief that Storyboard, Scene Planning, and Asset Generation
 * all build on.
 */

/**
 * The kinds of visual asset a segment can be sourced as. Recommendations only —
 * nothing is generated at this stage.
 */
export type VisualAssetType =
  | "stock-video"
  | "ai-image"
  | "ai-video"
  | "motion-graphics"
  | "screen-recording"
  | "mixed";

/** The fixed context the narrative timeline doesn't carry. */
export interface VisualDirectionContext {
  readonly platform: string;
  /** The overall look to stay consistent with (e.g. the ContentPlan's visualStyle). */
  readonly overallVisualStyle: string;
}

/** What the caller asks the visual director to turn into a plan. */
export interface VisualDirectionRequest {
  /** The narration timeline this direction must align to. */
  readonly narrative: NarrativeScript;
  /** Optional per-call overrides of the provider's default context. */
  readonly context?: Partial<VisualDirectionContext>;
}

/** The recommended visual treatment for one narration segment. */
export interface VisualDirectionSegment {
  /** Ties back to the narration segment this directs (e.g. "seg-1"). */
  readonly segmentId: string;
  readonly assetType: VisualAssetType;
  readonly cameraMovement: string;
  readonly visualStyle: string;
  readonly colorMood: string;
  readonly transition: string;
  readonly animationStyle: string;
  /** A short hint about where to source the asset (e.g. "Pexels", "AI (Flux)"). */
  readonly preferredSource: string;
  readonly notes: string;
}

/** Tokens + timing + routing recorded for one visual-direction generation. */
export interface VisualDirectionMetadata {
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
 * VisualDirectionPlan — the strongly-typed art-direction plan.
 *
 * `warnings` records anything the parser had to fall back on (missing fields,
 * unknown asset types, count mismatch vs the narration), so a broken plan is
 * never silently accepted. `metadata` carries token usage / latency.
 */
export interface VisualDirectionPlan {
  readonly segments: readonly VisualDirectionSegment[];
  readonly warnings: readonly string[];
  readonly metadata: VisualDirectionMetadata;
}

/** All valid asset types, for validation/coercion. */
export const VISUAL_ASSET_TYPES: readonly VisualAssetType[] = [
  "stock-video",
  "ai-image",
  "ai-video",
  "motion-graphics",
  "screen-recording",
  "mixed",
];
