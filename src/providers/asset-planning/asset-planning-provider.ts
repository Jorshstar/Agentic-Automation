import type { AssetPlanRequest, AssetPlan } from "./types.js";

/**
 * AssetPlanningProvider — the CONTRACT for anything that turns a visual direction
 * plan into an {@link AssetPlan}.
 *
 * Callers depend only on this interface, never on a specific AI service. Today a
 * Claude-backed implementation satisfies it; another provider could later, with
 * no change to the callers.
 */
export interface AssetPlanningProvider {
  /** Stable name for logs (e.g. "claude-asset-planning-provider"). */
  readonly name: string;
  /** Produce a per-segment asset-sourcing plan from visual direction. */
  plan(request: AssetPlanRequest): Promise<AssetPlan>;
}
