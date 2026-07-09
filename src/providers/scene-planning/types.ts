import type { NarrativeScript } from "../narrative/index.js";
import type { VisualDirectionPlan } from "../visual-direction/index.js";
import type { AssetPlan } from "../asset-planning/index.js";

/**
 * Scene planning types — the request/response shapes a scene-planning provider
 * speaks.
 *
 * A ScenePlan is the EXECUTION CONTRACT: it merges the narration timeline, the
 * visual direction, and the asset plan into one ordered list of fully-specified
 * scenes. Everything the production pipeline (Asset Generation, Voice, Captions,
 * Video Composition) needs to actually build the video is pinned here, keyed by a
 * single shared segment grid. Nothing is generated at this stage.
 */

/** Where captions sit on screen for a scene. */
export type CaptionPosition = "top" | "center" | "bottom" | "none";

/** The fixed context the upstream plans don't carry. */
export interface ScenePlanContext {
  readonly platform: string;
}

/** What the caller asks the scene planner to merge into a plan. */
export interface ScenePlanRequest {
  readonly narrative: NarrativeScript;
  readonly visualDirection: VisualDirectionPlan;
  readonly assetPlan: AssetPlan;
  /** Optional per-call overrides of the provider's default context. */
  readonly context?: Partial<ScenePlanContext>;
}

/** One fully-specified scene — the atomic unit the production pipeline builds. */
export interface Scene {
  readonly sceneId: string;
  /** The shared segment id this scene realizes (e.g. "seg-1"). */
  readonly segmentId: string;
  readonly startSecond: number;
  readonly endSecond: number;
  /** Short descriptor of the primary asset (provider + what to fetch/generate). */
  readonly primaryAsset: string;
  /** Short descriptor of the fallback asset. */
  readonly fallbackAsset: string;
  readonly cameraMovement: string;
  readonly transitionIn: string;
  readonly transitionOut: string;
  /** Short on-screen text (or empty). */
  readonly overlayText: string;
  readonly captionPosition: CaptionPosition;
  /** The narration/voice segment this scene is timed to (usually === segmentId). */
  readonly voiceSegmentId: string;
  readonly musicMood: string;
  readonly notes: string;
}

/** Tokens + timing + routing recorded for one scene-plan generation. */
export interface ScenePlanMetadata {
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
 * ScenePlan — the strongly-typed execution contract.
 *
 * `warnings` records anything the parser had to fall back on (missing fields,
 * unknown caption positions, count mismatch vs the narration), so a broken plan
 * is never silently accepted. `metadata` carries token usage / latency.
 */
export interface ScenePlan {
  readonly scenes: readonly Scene[];
  readonly warnings: readonly string[];
  readonly metadata: ScenePlanMetadata;
}

/** All valid caption positions, for validation/coercion. */
export const CAPTION_POSITIONS: readonly CaptionPosition[] = ["top", "center", "bottom", "none"];
