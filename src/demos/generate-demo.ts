/**
 * AI Kernel end-to-end demo — the FULL generation pipeline (Step 19).
 *
 * One call to `kernel.generate()` runs the complete flow:
 *   PromptManager (resolve + active version + render vars) → ModelSelector →
 *   Provider Factory → real Claude Provider → ResponseValidator →
 *   token + cost tracking → typed AIGenerateResult.
 *
 * The caller (a future ResearchAgent) knows ONLY the prompt id, variables, and
 * expected output — never prompts, providers, models, or tokens.
 *
 * Requires ANTHROPIC_API_KEY in the environment (see .env / README). If it's not
 * set, the demo prints a friendly notice and exits cleanly.
 *
 *   npm run demo:generate
 */
import { createClaudeAIKernel } from "../ai/index.js";
import type { AIGenerateRequest } from "../ai/index.js";
import { AuthenticationError } from "../ai/providers/index.js";
import { logger } from "../lib/logger.js";

// Load .env into process.env (Node 20.12+/22 built-in — no dependency).
// Trigger.dev tasks get this for free; a standalone `tsx` script does not.
try {
  process.loadEnvFile();
} catch {
  // No .env file — fall back to the ambient environment.
}

async function main(): Promise<void> {
  const kernel = createClaudeAIKernel();

  // Everything the caller provides: a prompt id, variables, expected output.
  // Provider ("claude"), model ("claude-opus-4-8"), and temperature (0.4) all
  // come from the prompt's metadata inside the Prompt Management System.
  const request: AIGenerateRequest = {
    promptId: "research.system",
    variables: {
      topic: "Artificial Intelligence",
      audience: "General Audience",
      tone: "Educational",
      language: "English",
      platform: "YouTube Shorts",
    },
    expectedOutput: { format: "text", description: "a short research briefing" },
    maxTokens: 512,
  };

  const result = await kernel.generate<string>(request);

  console.log("\n=== AI Kernel → Claude (AIGenerateResult) ===");
  console.log("Prompt ID:        ", result.promptId);
  console.log("Prompt Version:   ", result.promptVersion);
  console.log("Provider:         ", result.provider);
  console.log("Model:            ", result.model);
  console.log("Prompt Tokens:    ", result.usage.inputTokens);
  console.log("Completion Tokens:", result.usage.outputTokens);
  console.log("Total Tokens:     ", result.usage.totalTokens);
  console.log("Latency (ms):     ", result.latencyMs);
  console.log("\n--- Generated Content ---");
  console.log(result.output);
}

main().catch((error: unknown) => {
  if (error instanceof AuthenticationError) {
    // No key (or invalid key) — not a code failure; explain and exit cleanly.
    logger.warn("Skipping generate demo — set ANTHROPIC_API_KEY to run it", {
      reason: error.message,
    });
    return;
  }
  logger.error("Generate demo failed", { error: String(error) });
  process.exitCode = 1;
});
