import type { Niche, Platform } from "../../types/index.js";

/**
 * WorkflowMetadata — the unchanging "header" facts about one run.
 *
 * Set once near the start and read by everything afterwards: which niche, which
 * day, and which platforms the finished video targets.
 */
export interface WorkflowMetadata {
  /** Stable id for this workflow run. */
  readonly workflowId: string;
  /** The content niche this run produces for. */
  readonly niche: Niche;
  /** The calendar day this run is for, as `YYYY-MM-DD`. */
  readonly date: string;
  /** Platforms the finished video is intended for. */
  readonly platforms: readonly Platform[];
}
