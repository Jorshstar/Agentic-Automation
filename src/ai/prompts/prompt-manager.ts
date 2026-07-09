import type { PromptDefinition, PromptId, PromptRegistry } from "./prompt-registry.js";
import type { PromptMetadata } from "./prompt-metadata.js";
import type { PromptVersion, PromptVersionId } from "./prompt-version.js";
import type { TemplateVariables } from "./prompt-template.js";
import { extractPlaceholders, renderTemplate } from "./prompt-template.js";
import { PromptValidationError } from "./prompt-validation-error.js";

/**
 * Validation contracts (basic structural validation only).
 */
export type PromptValidationCode =
  | "missing-variables"
  | "unknown-placeholders"
  | "version-not-found"
  | "invalid-metadata";

export interface PromptValidationIssue {
  readonly code: PromptValidationCode;
  readonly message: string;
}

export interface PromptValidationResult {
  readonly valid: boolean;
  readonly issues: readonly PromptValidationIssue[];
}

/**
 * PromptManager — the PUBLIC entry point for prompts.
 *
 * Everything that needs a prompt goes through here (eventually the AI Kernel).
 * It resolves ids, picks the active version, renders variables, lists prompts,
 * and validates structurally. It never loads from files/DB — the registry it
 * wraps holds everything in memory.
 */
export class PromptManager {
  constructor(private readonly registry: PromptRegistry) {}

  /** All registered prompt ids. */
  listPrompts(): readonly PromptId[] {
    return this.registry.list();
  }

  /** Get a full definition (throws if unknown). */
  getPrompt(id: PromptId): PromptDefinition {
    const definition = this.registry.get(id);
    if (!definition) {
      throw new Error(`Prompt not found: "${id}"`);
    }
    return definition;
  }

  /** Get a prompt's metadata. */
  getMetadata(id: PromptId): PromptMetadata {
    return this.getPrompt(id).metadata;
  }

  /** Get a specific version, or the ACTIVE one when `version` is omitted. */
  getPromptVersion(id: PromptId, version?: PromptVersionId): PromptVersion {
    const definition = this.getPrompt(id);
    const target = version ?? definition.metadata.version;
    const found = definition.versions.find((entry) => entry.version === target);
    if (!found) {
      throw new Error(`Prompt version not found: "${id}@${target}"`);
    }
    return found;
  }

  /**
   * Render a prompt's active (or chosen) version with the given variables.
   *
   * REQUIRED-VARIABLE GUARD: before any substitution happens, every variable the
   * prompt declares in `metadata.requiredVariables` must be supplied and
   * non-empty. If not, this throws {@link PromptValidationError} instead of
   * rendering a prompt with a missing value. This is the single choke point that
   * protects every caller (including the AI Kernel).
   */
  renderPrompt(
    id: PromptId,
    variables: TemplateVariables,
    version?: PromptVersionId,
  ): string {
    const definition = this.getPrompt(id);
    this.assertRequiredVariables(definition.metadata, variables);
    const promptVersion = this.getPromptVersion(id, version);
    return renderTemplate(promptVersion.template, variables);
  }

  /**
   * Throw if any declared required variable is missing or blank. A variable
   * counts as "provided" only when its key is present AND (for strings) not
   * empty/whitespace — so `""` is treated as missing, not as a valid value.
   */
  assertRequiredVariables(metadata: PromptMetadata, variables: TemplateVariables): void {
    const required = metadata.requiredVariables ?? [];
    if (required.length === 0) {
      return;
    }
    const missing = required.filter((key) => {
      const value = variables[key];
      if (value === undefined || value === null) {
        return true;
      }
      return typeof value === "string" && value.trim() === "";
    });
    if (missing.length > 0) {
      throw new PromptValidationError(metadata.id, missing);
    }
  }

  /** Basic structural validation of a prompt + supplied variables. */
  validatePrompt(
    id: PromptId,
    variables: TemplateVariables = {},
    version?: PromptVersionId,
  ): PromptValidationResult {
    const definition = this.registry.get(id);
    if (!definition) {
      return {
        valid: false,
        issues: [{ code: "version-not-found", message: `Prompt not found: "${id}"` }],
      };
    }

    const issues: PromptValidationIssue[] = [];

    // Metadata sanity.
    if (!definition.metadata.id || !definition.metadata.name) {
      issues.push({ code: "invalid-metadata", message: "Metadata is missing id or name." });
    }

    // Version resolution.
    const target = version ?? definition.metadata.version;
    const promptVersion = definition.versions.find((entry) => entry.version === target);
    if (!promptVersion) {
      issues.push({
        code: "version-not-found",
        message: `Version not found: "${id}@${target}".`,
      });
      return { valid: false, issues };
    }

    // Placeholders vs supplied variables.
    const placeholders = extractPlaceholders(promptVersion.template);
    const provided = new Set(Object.keys(variables));
    for (const placeholder of placeholders) {
      if (!provided.has(placeholder)) {
        issues.push({ code: "missing-variables", message: `Missing variable: "${placeholder}".` });
      }
    }
    for (const key of provided) {
      if (!placeholders.includes(key)) {
        issues.push({ code: "unknown-placeholders", message: `Unknown placeholder variable: "${key}".` });
      }
    }

    return { valid: issues.length === 0, issues };
  }
}
