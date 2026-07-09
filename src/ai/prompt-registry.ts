/**
 * PromptRegistry — a phone book of prompts.
 *
 * Prompts are identified by stable IDs (e.g. "research.user"), NOT written inline
 * in agent code. This keeps prompt text out of business logic and lets prompts be
 * versioned/edited in one place. (No prompt LOADING is implemented yet — this is
 * only the contract.)
 */

/** A prompt id, e.g. "research.system" or "script.user". */
export type PromptId = string;

/** A stored prompt template (raw text, may contain {{variable}} placeholders). */
export interface PromptTemplate {
  readonly id: PromptId;
  readonly template: string;
}

export interface PromptRegistry {
  /** Fetch a template by id. */
  get(id: PromptId): PromptTemplate;
  /** Whether a template with this id exists. */
  has(id: PromptId): boolean;
}
