import type { NarrativeRequest, NarrativeScript } from "./types.js";

/**
 * NarrativeProvider — the CONTRACT for anything that turns a ContentPlan into a
 * timed {@link NarrativeScript}.
 *
 * Callers depend only on this interface, never on a specific AI service. Today a
 * Claude-backed implementation satisfies it; another provider could later, with
 * no change to the callers.
 */
export interface NarrativeProvider {
  /** Stable name for logs (e.g. "claude-narrative-provider"). */
  readonly name: string;
  /** Produce a timed narration script from a content plan. */
  narrate(request: NarrativeRequest): Promise<NarrativeScript>;
}
