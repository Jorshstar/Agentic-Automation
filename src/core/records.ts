import type { Niche } from "../types/index.js";
import type { WorkflowState } from "./workflow-state.js";

/**
 * Record shapes — the plain data that repositories store and return.
 *
 * These describe WHAT is persisted, not HOW. There is no database, ORM, or SQL
 * here — only the typed "rows". A real storage backend is added much later and
 * must produce/accept exactly these shapes.
 */

/** One end-to-end video workflow. */
export interface WorkflowRecord {
  readonly id: string;
  readonly correlationId: string;
  readonly niche: Niche;
  readonly state: WorkflowState;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** One attempt at running a workflow (a workflow may be retried). */
export interface ExecutionRecord {
  readonly id: string;
  readonly workflowId: string;
  readonly state: WorkflowState;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly success?: boolean;
}

/** Kinds of files an agent can produce. */
export type AssetKind = "script" | "audio" | "image" | "video" | "metadata";

/** One produced file/artifact belonging to a workflow. */
export interface AssetRecord {
  readonly id: string;
  readonly workflowId: string;
  readonly kind: AssetKind;
  /** Where the asset lives (a local path or remote URL). */
  readonly location: string;
  readonly createdAt: string;
}
