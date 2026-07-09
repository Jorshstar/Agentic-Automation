/**
 * Provider SDK Layer demo — proves the normalized request/response (Step 17).
 *
 * Build a normalized ProviderRequest → send it to a ProviderClient (mock) →
 * receive a standardized ProviderResponse → print it. No AI, no network.
 *
 *   npm run demo:provider
 */
import { createProviderClient } from "../ai/providers/index.js";
import type { ProviderRequest } from "../ai/providers/index.js";
import { logger } from "../lib/logger.js";

async function main(): Promise<void> {
  // Ask for "openai" — not implemented yet, so the factory returns the mock
  // client. (As of Step 18, "claude" returns the REAL adapter — see demo:claude.)
  const client = createProviderClient("openai");

  const request: ProviderRequest = {
    systemPrompt: "You are a research assistant for short-form videos.",
    userPrompt: "Research: why the ocean glows at night. Return the key points.",
    temperature: 0.4,
    maxTokens: 512,
    expectedOutput: "text",
    model: "gpt-mock",
    provider: "openai",
    metadata: { correlationId: "demo-123" },
  };

  const response = await client.generate(request);

  console.log("\n=== Standardized ProviderResponse ===");
  console.log(JSON.stringify(response, null, 2));
}

main().catch((error: unknown) => {
  logger.error("Provider demo failed", { error: String(error) });
  process.exitCode = 1;
});
