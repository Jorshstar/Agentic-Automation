import type { AIKernel } from "./ai-kernel-interface.js";
import type { AIGenerateRequest, AIGenerateResult, ProviderName } from "./types.js";
import type { PromptManager } from "./prompts/index.js";
import type { ResponseValidator } from "./response-validator.js";
import type { ModelSelector } from "./model-selector.js";
import type { CostTracker } from "./cost-tracker.js";
import type { TokenTracker } from "./token-tracker.js";
import type { ProviderClient, ProviderRequest } from "./providers/index.js";

/**
 * A factory that hands back a ProviderClient for a given provider name. This is
 * exactly the Provider Factory's shape (`createProviderClient`); injecting it
 * (instead of importing it) keeps the kernel testable and provider-agnostic.
 */
export type ProviderClientFactory = (provider: ProviderName) => ProviderClient;

/** The collaborators the AI Kernel orchestrates (injected for testability). */
export interface AIKernelDependencies {
  readonly promptManager: PromptManager;
  readonly modelSelector: ModelSelector;
  readonly providerFactory: ProviderClientFactory;
  readonly responseValidator: ResponseValidator;
  readonly costTracker: CostTracker;
  readonly tokenTracker: TokenTracker;
}

/**
 * DefaultAIKernel — the orchestrator. It runs the SAME pipeline for every AI
 * call, knowing nothing about Research/Script/Voice/etc:
 *
 *   promptId → PromptManager (resolve + active version + render vars) →
 *   choose model/temperature/provider → Provider Factory → ProviderClient →
 *   ResponseValidator → (record tokens + cost) → typed AIGenerateResult
 *
 * Every step is a pluggable interface, so the mock provider and the real Claude
 * provider run through this exact flow with zero changes here.
 */
export class DefaultAIKernel implements AIKernel {
  constructor(private readonly deps: AIKernelDependencies) {}

  async generate<TOutput = unknown>(
    request: AIGenerateRequest,
  ): Promise<AIGenerateResult<TOutput>> {
    const {
      promptManager,
      modelSelector,
      providerFactory,
      responseValidator,
      costTracker,
      tokenTracker,
    } = this.deps;

    // 1. Resolve the prompt + its ACTIVE version from the Prompt Management System.
    const metadata = promptManager.getMetadata(request.promptId);
    const activeVersion = promptManager.getPromptVersion(request.promptId);

    // 2. Render the active version with the caller's variables.
    const renderedPrompt = promptManager.renderPrompt(
      request.promptId,
      request.variables ?? {},
    );

    // 2b. Optionally render a SYSTEM prompt (role + rules) from its own registry
    //     entry, using the same variables. Keeps the task prompt task-only.
    const renderedSystemPrompt =
      request.systemPromptId !== undefined
        ? promptManager.renderPrompt(request.systemPromptId, request.variables ?? {})
        : undefined;

    // 3. Decide model, temperature, and provider.
    //    Priority: explicit request override > prompt metadata > ModelSelector.
    const model = request.model ?? metadata.preferredModel ?? modelSelector.selectModel(request);
    const temperature =
      request.temperature ?? metadata.temperature ?? modelSelector.selectTemperature(request);
    const providerName: ProviderName = request.provider ?? metadata.preferredProvider ?? "mock";

    // 4. Ask the Provider Factory for a client, then build a NORMALIZED request.
    const client = providerFactory(providerName);
    const providerRequest: ProviderRequest = {
      userPrompt: renderedPrompt,
      ...(renderedSystemPrompt !== undefined ? { systemPrompt: renderedSystemPrompt } : {}),
      temperature,
      maxTokens: request.maxTokens,
      expectedOutput: request.expectedOutput.format,
      model,
      provider: providerName,
      ...(request.webSearch ? { webSearch: request.webSearch } : {}),
      metadata: { promptId: request.promptId, promptVersion: activeVersion.version },
    };

    // 5. Generate through the Provider SDK Layer (Claude, mock, ...).
    const response = await client.generate(providerRequest);

    // 6. Validate the provider's content into the expected output shape.
    const output = responseValidator.validate<TOutput>(response.content, request.expectedOutput);

    // 7. Record token usage + (placeholder) cost from the returned usage.
    tokenTracker.record({
      inputTokens: response.usage.promptTokens,
      outputTokens: response.usage.completionTokens,
    });
    costTracker.record({ provider: response.provider, model: response.model, costUsd: 0 });

    // 8. Return a typed, provider-agnostic result.
    return {
      output,
      promptId: request.promptId,
      promptVersion: activeVersion.version,
      provider: response.provider,
      model: response.model,
      usage: {
        inputTokens: response.usage.promptTokens,
        outputTokens: response.usage.completionTokens,
        totalTokens: response.usage.totalTokens,
        costUsd: 0,
      },
      latencyMs: response.latencyMs,
      citations: response.citations,
      webSearchCount: response.webSearchCount,
    };
  }
}
