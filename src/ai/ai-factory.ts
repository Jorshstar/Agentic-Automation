import type { AIKernel } from "./ai-kernel-interface.js";
import { DefaultAIKernel } from "./ai-kernel.js";
import type { AIKernelDependencies, ProviderClientFactory } from "./ai-kernel.js";
import type { ResponseValidator } from "./response-validator.js";
import type { ModelSelector } from "./model-selector.js";
import type { CostTracker, CostRecord } from "./cost-tracker.js";
import type { TokenTracker, TokenRecord, TokenTotals } from "./token-tracker.js";
import type { AIGenerateRequest, ExpectedOutput } from "./types.js";
import { createDefaultPromptManager } from "./prompts/index.js";
import { MockProviderClient, createProviderClient } from "./providers/index.js";

/**
 * Kernel-level fakes for the parts that are still placeholders (model choice,
 * response validation, usage tracking). The Prompt Management System and the
 * Provider SDK Layer are now REAL — only these three remain mocked.
 */

/** Fallback model/temperature, used only when neither request nor prompt metadata specifies them. */
class MockModelSelector implements ModelSelector {
  selectModel(_request: AIGenerateRequest): string {
    return "mock-model";
  }
  selectTemperature(_request: AIGenerateRequest): number {
    return 0.7;
  }
}

/** Returns the raw text as the output (real JSON/structured parsing comes later). */
class PassthroughResponseValidator implements ResponseValidator {
  validate<TOutput>(raw: string, _expected: ExpectedOutput): TOutput {
    return raw as unknown as TOutput;
  }
}

/** Accumulates cost records in memory (placeholder — records usage, no pricing). */
class InMemoryCostTracker implements CostTracker {
  private total = 0;
  record(record: CostRecord): void {
    this.total += record.costUsd;
  }
  totalUsd(): number {
    return this.total;
  }
}

/** Accumulates token records in memory. */
class InMemoryTokenTracker implements TokenTracker {
  private input = 0;
  private output = 0;
  record(record: TokenRecord): void {
    this.input += record.inputTokens;
    this.output += record.outputTokens;
  }
  totals(): TokenTotals {
    return { inputTokens: this.input, outputTokens: this.output };
  }
}

/**
 * Shared wiring for both kernels. The ONLY thing that differs between the mock
 * kernel and the real Claude kernel is which Provider Factory is injected —
 * everything else (real Prompt Manager, selector, validator, trackers) is common.
 */
function buildDependencies(providerFactory: ProviderClientFactory): AIKernelDependencies {
  return {
    promptManager: createDefaultPromptManager(), // real, in-memory (no network)
    modelSelector: new MockModelSelector(),
    providerFactory,
    responseValidator: new PassthroughResponseValidator(),
    costTracker: new InMemoryCostTracker(),
    tokenTracker: new InMemoryTokenTracker(),
  };
}

/**
 * createDefaultAIKernel — an offline kernel. Prompt Management is real, but every
 * request is served by the MockProviderClient (no API key, no network). Used by
 * `demo:ai`.
 */
export function createDefaultAIKernel(): AIKernel {
  return new DefaultAIKernel(buildDependencies(() => new MockProviderClient()));
}

/**
 * createClaudeAIKernel — a live kernel wired to the real Provider SDK Layer. The
 * injected factory honors the resolved provider name, so a "claude" prompt hits
 * the real Anthropic adapter. Requires ANTHROPIC_API_KEY. Used by `demo:generate`.
 */
export function createClaudeAIKernel(): AIKernel {
  return new DefaultAIKernel(buildDependencies(createProviderClient));
}
