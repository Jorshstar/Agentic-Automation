import type { Niche, Platform } from "../types/index.js";

/**
 * BrainGoal — the single input to `brain.execute(goal)`.
 *
 * A "goal" describes WHAT we want the Brain to achieve (e.g. "make today's scary
 * story video"), not HOW. The Brain figures out the how (the plan). Most fields
 * are optional so a goal can be as vague or as specific as you like.
 */
export interface BrainGoal {
  /** Stable id for this goal (used as a key in runtime memory). */
  readonly id: string;
  /** Plain-English description of what to achieve. */
  readonly description: string;
  /** The content niche, if known. */
  readonly niche?: Niche;
  /** A specific topic title, if the caller already has one. */
  readonly topicTitle?: string;
  /** Platforms the result targets. */
  readonly platforms?: readonly Platform[];
  /**
   * Explicit ordered agent names to run. If omitted, the planner derives a
   * sensible default pipeline from the registered agents.
   */
  readonly requestedAgents?: readonly string[];
  /** Agent names whose plan nodes should be marked skippable. */
  readonly skippableAgents?: readonly string[];
  /** Free-form extra context (kept generic; no secrets). */
  readonly metadata?: Readonly<Record<string, unknown>>;
}
