/**
 * AI Kernel demo — proves the mock-wired AI Kernel works end-to-end (Step 15).
 *
 * It builds the default (all-mock) kernel and calls the single public method
 * `generate(request)`. No real AI, no network, no prompt files — the kernel just
 * runs its pipeline (registry → renderer → router → provider → validator).
 *
 *   npm run demo:ai
 */
import { createDefaultAIKernel } from "../ai/index.js";
import type { AIGenerateRequest } from "../ai/index.js";
import { logger } from "../lib/logger.js";

async function main(): Promise<void> {
  const kernel = createDefaultAIKernel();

  // The caller knows only: prompt id, variables, and expected output.
  const request: AIGenerateRequest = {
    promptId: "research.user",
    variables: { topic: "Renewable energy breakthroughs", niche: "tech-news" },
    expectedOutput: { format: "text", description: "a short research summary" },
  };

  const result = await kernel.generate<string>(request);

  console.log("\n=== AI Kernel result ===");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error: unknown) => {
  logger.error("AI demo failed", { error: String(error) });
  process.exitCode = 1;
});
