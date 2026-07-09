/**
 * The Prompt Management System — the single source of truth for prompts.
 *
 * Build one with `createDefaultPromptManager()` and use the `PromptManager` to
 * look up, version, render, list, and validate prompts. Everything is in memory.
 */

// Public entry point + validation contracts.
export { PromptManager } from "./prompt-manager.js";
export type {
  PromptValidationResult,
  PromptValidationIssue,
  PromptValidationCode,
} from "./prompt-manager.js";
export { PromptValidationError } from "./prompt-validation-error.js";

// Registry + definition.
export { InMemoryPromptRegistry } from "./prompt-registry.js";
export type { PromptRegistry, PromptDefinition, PromptId } from "./prompt-registry.js";

// Versioning + metadata + template.
export type { PromptVersion, PromptVersionId, PromptStatus } from "./prompt-version.js";
export type { PromptMetadata } from "./prompt-metadata.js";
export { extractPlaceholders, renderTemplate } from "./prompt-template.js";
export type { PromptTemplate, TemplateVariables } from "./prompt-template.js";

// Mock data + default factory.
export { MOCK_PROMPTS, createDefaultPromptManager } from "./mock-prompts.js";
