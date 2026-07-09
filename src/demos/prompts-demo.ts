/**
 * Prompt Management demo — exercises the PromptManager (Step 16).
 *
 * It lists prompts, retrieves one by id, resolves the active version, renders
 * variables, prints metadata, and validates. All in memory; no AI, no network,
 * no files.
 *
 *   npm run demo:prompts
 */
import { createDefaultPromptManager } from "../ai/prompts/index.js";
import { logger } from "../lib/logger.js";

function main(): void {
  const prompts = createDefaultPromptManager();

  // 1. List available prompts.
  console.log("\n=== Available prompts ===");
  console.log(prompts.listPrompts().join("\n"));

  // 2. Retrieve one by id + print its metadata.
  console.log("\n=== Metadata: research.system ===");
  console.log(JSON.stringify(prompts.getMetadata("research.system"), null, 2));

  // 3. Retrieve the ACTIVE version (metadata points at v2).
  const active = prompts.getPromptVersion("research.system");
  console.log("\n=== Active version: research.system ===");
  console.log(JSON.stringify(active, null, 2));

  // 4. Render variables into a prompt.
  console.log("\n=== Rendered: research.user ===");
  console.log(
    prompts.renderPrompt("research.user", {
      topic: "Why the ocean glows at night",
      audience: "curious teens",
    }),
  );

  // 5. Validate — a good call and a bad call.
  console.log("\n=== Validation: script.user (missing some variables) ===");
  console.log(
    JSON.stringify(
      prompts.validatePrompt("script.user", { topic: "Ocean glow", duration: 60 }),
      null,
      2,
    ),
  );
}

try {
  main();
} catch (error: unknown) {
  logger.error("Prompts demo failed", { error: String(error) });
  process.exitCode = 1;
}
