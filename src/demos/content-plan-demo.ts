/**
 * Content Planning demo — the stage BETWEEN research and script (Step 21).
 *
 * A representative ResearchResult is fed into the ClaudeContentPlanningProvider,
 * which calls the ONE AI entry point (AIKernel.generate()) and returns a
 * structured ContentPlan:
 *
 *   ResearchResult → ContentPlanningProvider → AIKernel.generate() → Claude
 *                  → parsed ContentPlan
 *
 * This is a PROVIDER demo only — it is NOT wired into the workflow yet.
 *
 * Requires ANTHROPIC_API_KEY (see .env / README). Without it, the demo prints a
 * friendly notice and exits cleanly.
 *
 *   npm run demo:content-plan
 */
import { createClaudeAIKernel } from "../ai/index.js";
import { ClaudeContentPlanningProvider } from "../providers/content-planning/index.js";
import type { ResearchResult } from "../providers/research/index.js";
import { logger } from "../lib/logger.js";

// Load .env into process.env (Node built-in). tsx doesn't do this automatically.
try {
  process.loadEnvFile();
} catch {
  // No .env file — fall back to the ambient environment.
}

/** A representative research result (as the Research stage would produce). */
const SAMPLE_RESEARCH: ResearchResult = {
  summary:
    "Artificial intelligence is transforming healthcare by helping doctors diagnose diseases " +
    "faster, personalize treatments, and reduce paperwork. It supports — but does not replace — " +
    "medical professionals, and raises real questions about accuracy, privacy, and oversight.",
  keyPoints: [
    "AI can detect diseases like cancer in medical scans, sometimes matching specialists.",
    "It predicts patient risks early, allowing faster treatment and better outcomes.",
    "AI tools reduce paperwork, freeing doctors to spend more time with patients.",
    "Personalized medicine uses AI to tailor treatments to a patient's unique data.",
    "Human doctors stay in charge — AI assists decisions but requires oversight.",
  ],
  references: [],
  warnings: [],
  metadata: {
    promptId: "research.system",
    promptVersion: "v2",
    provider: "claude",
    model: "claude-opus-4-8",
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    latencyMs: 0,
  },
};

async function main(): Promise<void> {
  // No key ⇒ nothing to demo. Check presence only (never log the value).
  if (!process.env.ANTHROPIC_API_KEY) {
    logger.warn("Skipping content-plan demo — set ANTHROPIC_API_KEY to run it");
    return;
  }

  const kernel = createClaudeAIKernel();
  const provider = new ClaudeContentPlanningProvider(kernel);

  const plan = await provider.plan({
    topic: "Artificial Intelligence in Healthcare",
    research: SAMPLE_RESEARCH,
  });

  console.log("\n=== ContentPlanningProvider → AI Kernel → Claude ===");
  console.log("Provider:", provider.name);

  console.log("\n--- Hook ---");
  console.log(plan.hook || "(none)");

  console.log("\n--- Core Message ---");
  console.log(plan.coreMessage || "(none)");

  console.log("\n--- Sections ---");
  plan.sections.forEach((section, index) => {
    console.log(`${index + 1}. ${section.title}  (${section.durationSeconds}s)`);
    console.log(`   Purpose: ${section.purpose}`);
    for (const point of section.keyPoints) {
      console.log(`     • ${point}`);
    }
  });

  console.log("\n--- Call To Action ---");
  console.log(plan.callToAction || "(none)");

  console.log("\n--- Estimated Duration ---");
  console.log(`${plan.estimatedDurationSeconds}s`);

  console.log("\n--- Token Usage / Latency ---");
  console.log(JSON.stringify(plan.metadata.tokenUsage), `| ${plan.metadata.latencyMs} ms`);

  if (plan.warnings.length > 0) {
    console.log("\n--- Warnings ---");
    for (const warning of plan.warnings) {
      console.log(" !", warning);
    }
  }
}

main().catch((error: unknown) => {
  logger.error("Content-plan demo failed", { error: String(error) });
  process.exitCode = 1;
});
