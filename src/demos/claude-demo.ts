/**
 * Claude provider demo — calls the REAL Anthropic API (Step 18).
 *
 * Build a normalized ProviderRequest → send it through the ClaudeProviderClient
 * → get a standardized ProviderResponse back → print content/usage/model/latency.
 *
 * Requires ANTHROPIC_API_KEY in the environment (see .env / README). If it's not
 * set, the demo prints a friendly notice and exits cleanly.
 *
 *   npm run demo:claude
 */
import { createProviderClient, AuthenticationError } from "../ai/providers/index.js";
import type { ProviderRequest } from "../ai/providers/index.js";
import { logger } from "../lib/logger.js";

// Load .env into process.env (Node 20.12+/22 built-in — no dependency).
// Trigger.dev tasks get this for free; a standalone `tsx` script does not.
try {
  process.loadEnvFile();
} catch {
  // No .env file — fall back to the ambient environment.
}

async function main(): Promise<void> {
  const client = createProviderClient("claude");

  const request: ProviderRequest = {
    systemPrompt: "You are a concise research assistant. Answer in one sentence.",
    userPrompt: "Why does the ocean sometimes glow at night?",
    temperature: 1,
    maxTokens: 256,
    expectedOutput: "text",
    model: "claude-opus-4-8",
    provider: "claude",
  };

  const response = await client.generate(request);

  console.log("\n=== Claude ProviderResponse ===");
  console.log("content:  ", response.content);
  console.log("model:    ", response.model);
  console.log("usage:    ", JSON.stringify(response.usage));
  console.log("finish:   ", response.finishReason);
  console.log("latencyMs:", response.latencyMs);
}

main().catch((error: unknown) => {
  if (error instanceof AuthenticationError) {
    // No key (or invalid key) — not a code failure; explain and exit cleanly.
    logger.warn("Skipping Claude demo — set ANTHROPIC_API_KEY to run it", {
      reason: error.message,
    });
    return;
  }
  logger.error("Claude demo failed", { error: String(error) });
  process.exitCode = 1;
});
