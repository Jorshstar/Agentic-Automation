import type { PromptMetadata } from "./prompt-metadata.js";
import type { PromptVersion } from "./prompt-version.js";

/**
 * Prompt registry — stores prompt DEFINITIONS (metadata + all versions) by id.
 *
 * This is a richer store than the AI Kernel's simple prompt lookup: each entry
 * carries full metadata and its version history. In-memory only.
 */

/** A prompt id, e.g. "research.system". */
export type PromptId = string;

/** A complete prompt: its metadata plus every version. */
export interface PromptDefinition {
  readonly metadata: PromptMetadata;
  readonly versions: readonly PromptVersion[];
}

export interface PromptRegistry {
  register(definition: PromptDefinition): void;
  get(id: PromptId): PromptDefinition | undefined;
  has(id: PromptId): boolean;
  list(): readonly PromptId[];
}

/** A plain in-memory registry backed by a Map. */
export class InMemoryPromptRegistry implements PromptRegistry {
  private readonly prompts = new Map<PromptId, PromptDefinition>();

  register(definition: PromptDefinition): void {
    this.prompts.set(definition.metadata.id, definition);
  }

  get(id: PromptId): PromptDefinition | undefined {
    return this.prompts.get(id);
  }

  has(id: PromptId): boolean {
    return this.prompts.has(id);
  }

  list(): readonly PromptId[] {
    return [...this.prompts.keys()];
  }
}
