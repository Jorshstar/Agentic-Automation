/**
 * The AI layer — the single entry point for every AI interaction.
 *
 * Build a kernel with `createDefaultAIKernel()` (all mocks for now) and call
 * `kernel.generate(request)`. Agents will depend only on the `AIKernel`
 * interface — never on prompts or providers directly.
 */

// The kernel + its public method.
export { DefaultAIKernel } from "./ai-kernel.js";
export type { AIKernel } from "./ai-kernel-interface.js";
export type { AIKernelDependencies, ProviderClientFactory } from "./ai-kernel.js";

// Factories: mock-wired (offline) and Claude-wired (live Provider SDK Layer).
export { createDefaultAIKernel, createClaudeAIKernel } from "./ai-factory.js";

// Request/result vocabulary.
export type {
  AIGenerateRequest,
  AIGenerateResult,
  AIUsage,
  Citation,
  WebSearchOptions,
  ExpectedOutput,
  OutputFormat,
  ProviderName,
  PromptVariable,
} from "./types.js";

// Component contracts (interfaces only).
export type { PromptRegistry, PromptTemplate, PromptId } from "./prompt-registry.js";
export type { PromptRenderer } from "./prompt-renderer.js";
export type { ProviderRouter } from "./provider-router.js";
export type {
  LLMProvider,
  LLMCompletionRequest,
  LLMCompletionResponse,
} from "./llm-provider.js";
export type { ResponseValidator } from "./response-validator.js";
export type { ModelSelector } from "./model-selector.js";
export type { CostTracker, CostRecord } from "./cost-tracker.js";
export type { TokenTracker, TokenRecord, TokenTotals } from "./token-tracker.js";
