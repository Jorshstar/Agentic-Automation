import type { PromptId } from "./prompt-registry.js";

/**
 * Shared AI Kernel types — the vocabulary of an AI interaction. Deliberately
 * generic: the kernel knows about prompts, variables, providers, and expected
 * output — never about Research, Script, Voice, etc.
 */

/** Providers the router is designed to support (no implementations here). */
export type ProviderName =
  | "openai"
  | "claude"
  | "gemini"
  | "perplexity"
  | "deepseek"
  | "local"
  | "mock";

/** The shape the caller expects the response to be in. */
export type OutputFormat = "json" | "markdown" | "text" | "structured";

/** A value that can be injected into a prompt template. */
export type PromptVariable = string | number | boolean;

/** Describes what the caller expects back. */
export interface ExpectedOutput {
  readonly format: OutputFormat;
  /** Optional human description of the shape (documentation only for now). */
  readonly description?: string;
}

/** Ask the provider to run Anthropic's server-side web search for this call. */
export interface WebSearchOptions {
  /** Hard cap on searches for this request (bounds cost; ~$0.01 per search). */
  readonly maxUses?: number;
  /** Restrict results to these bare domains (no scheme). */
  readonly allowedDomains?: readonly string[];
}

/** A strongly-typed request to the AI Kernel. */
export interface AIGenerateRequest {
  /** Which prompt to use as the USER message (from the registry). */
  readonly promptId: PromptId;
  /**
   * Optional prompt used as the SYSTEM instruction. Rendered with the same
   * variables. Keeps role/rules out of the task prompt.
   */
  readonly systemPromptId?: PromptId;
  /** Values to inject into the prompt's placeholders. */
  readonly variables?: Readonly<Record<string, PromptVariable>>;
  /** What kind of output is expected (drives validation). */
  readonly expectedOutput: ExpectedOutput;
  /** Optional explicit provider (else the router decides). */
  readonly provider?: ProviderName;
  /** Optional model override (else the model selector decides). */
  readonly model?: string;
  /** Optional temperature override (else the model selector decides). */
  readonly temperature?: number;
  /** Optional cap on output tokens (else the provider adapter's default). */
  readonly maxTokens?: number;
  /** When set, the model may search the live web and return real citations. */
  readonly webSearch?: WebSearchOptions;
}

/** A source the model actually cited from a live web search. */
export interface Citation {
  readonly url: string;
  readonly title: string;
}

/** Token/cost usage for one generation (cost is still a placeholder). */
export interface AIUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly costUsd: number;
}

/** The structured result of a generation, generic over the output type. */
export interface AIGenerateResult<TOutput = unknown> {
  readonly output: TOutput;
  readonly promptId: PromptId;
  /** The prompt version that was actually rendered (e.g. "v2"). */
  readonly promptVersion: string;
  readonly provider: ProviderName;
  readonly model: string;
  readonly usage: AIUsage;
  /** Provider round-trip time in milliseconds. */
  readonly latencyMs: number;
  /** Real sources the model cited (empty unless `webSearch` was requested). */
  readonly citations: readonly Citation[];
  /** How many live web searches the provider actually ran (for cost). */
  readonly webSearchCount: number;
}
