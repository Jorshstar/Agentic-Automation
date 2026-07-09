import type { ScenePlanRequest, ScenePlan } from "./types.js";

/**
 * ScenePlanningProvider — the CONTRACT for anything that merges the narration
 * timeline, visual direction, and asset plan into a {@link ScenePlan}.
 *
 * Callers depend only on this interface, never on a specific AI service. Today a
 * Claude-backed implementation satisfies it; another provider could later, with
 * no change to the callers.
 */
export interface ScenePlanningProvider {
  /** Stable name for logs (e.g. "claude-scene-planning-provider"). */
  readonly name: string;
  /** Merge the upstream plans into an ordered, fully-specified scene plan. */
  plan(request: ScenePlanRequest): Promise<ScenePlan>;
}
