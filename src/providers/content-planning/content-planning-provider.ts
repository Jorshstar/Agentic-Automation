import type { ContentPlan, ContentPlanRequest } from "./types.js";

/**
 * ContentPlanningProvider — the CONTRACT for anything that turns research into a
 * structured {@link ContentPlan}.
 *
 * Callers depend only on this interface, never on a specific AI service. Today a
 * Claude-backed implementation satisfies it; tomorrow another provider could,
 * with no change to the callers.
 */
export interface ContentPlanningProvider {
  /** Stable name for logs (e.g. "claude-content-planning-provider"). */
  readonly name: string;
  /** Produce a structured content plan from research. */
  plan(request: ContentPlanRequest): Promise<ContentPlan>;
}
