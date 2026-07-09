import type { VisualDirectionRequest, VisualDirectionPlan } from "./types.js";

/**
 * VisualDirectionProvider — the CONTRACT for anything that turns a narration
 * timeline into a {@link VisualDirectionPlan}.
 *
 * Callers depend only on this interface, never on a specific AI service. Today a
 * Claude-backed implementation satisfies it; another provider could later, with
 * no change to the callers.
 */
export interface VisualDirectionProvider {
  /** Stable name for logs (e.g. "claude-visual-direction-provider"). */
  readonly name: string;
  /** Produce per-segment visual direction from a narration timeline. */
  direct(request: VisualDirectionRequest): Promise<VisualDirectionPlan>;
}
