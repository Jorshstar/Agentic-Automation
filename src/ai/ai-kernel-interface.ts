import type { AIGenerateRequest, AIGenerateResult } from "./types.js";

/**
 * AIKernel — the single entry point for EVERY AI interaction.
 *
 * Agents (and anything else) call `generate(request)` and get back a structured
 * result. They never see prompts, providers, models, or tokens directly. The
 * kernel exposes exactly one public method.
 */
export interface AIKernel {
  generate<TOutput = unknown>(request: AIGenerateRequest): Promise<AIGenerateResult<TOutput>>;
}
