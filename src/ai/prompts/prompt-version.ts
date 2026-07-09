/**
 * Prompt versioning.
 *
 * Every prompt can have multiple versions (v1, v2, v3...), each with its own
 * status (stable / experimental / deprecated). The Prompt Manager always knows
 * which version is "active" (see PromptMetadata.version). No persistence — all
 * versions live in memory.
 */

export type PromptStatus = "stable" | "experimental" | "deprecated";

/** A version identifier, e.g. "v1", "v2". */
export type PromptVersionId = string;

export interface PromptVersion {
  /** Version id (e.g. "v2"). */
  readonly version: PromptVersionId;
  readonly status: PromptStatus;
  /** The prompt text for this version (may contain {{placeholders}}). */
  readonly template: string;
  /** When this version was created (ISO 8601). */
  readonly createdAt: string;
}
