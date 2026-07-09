/**
 * Research demo — the FIRST agent powered by real AI (Step 20).
 *
 * The SAME ResearchAgent from Steps 5–7 now runs on a ClaudeResearchProvider
 * instead of the mock. The agent code is unchanged; only its injected provider
 * differs. The flow:
 *
 *   Topic → ResearchAgent → ResearchProvider → AIKernel.generate() → Claude
 *         → parsed ResearchResult
 *
 * Requires ANTHROPIC_API_KEY in the environment (see .env / README). Without it,
 * the demo prints a friendly notice and exits cleanly.
 *
 *   npm run demo:research
 */
import { ResearchAgent } from "../agents/research/research-agent.js";
import { ClaudeResearchProvider } from "../providers/research/claude-research-provider.js";
import { createClaudeAIKernel } from "../ai/index.js";
import type { WorkflowContext } from "../core/workflow-context.js";
import { withWorkflowState } from "../core/workflow-context.js";
import { WorkflowState } from "../core/workflow-state.js";
import { createPipelineData } from "../pipeline/pipeline-builder.js";
import type { PipelineData } from "../pipeline/pipeline-data.js";
import type { Topic } from "../pipeline/models/topic.js";
import { newCorrelationId } from "../lib/correlation.js";
import { logger } from "../lib/logger.js";
import { runtimeConfig } from "../config/runtime.js";

// Load .env into process.env (Node built-in). tsx doesn't do this automatically.
try {
  process.loadEnvFile();
} catch {
  // No .env file — fall back to the ambient environment.
}

async function main(): Promise<void> {
  // No key ⇒ nothing to demo. Check presence only (never log the value).
  if (!process.env.ANTHROPIC_API_KEY) {
    logger.warn("Skipping research demo — set ANTHROPIC_API_KEY to run it");
    return;
  }

  // Dependency injection: the SAME agent, wired to the REAL provider.
  const kernel = createClaudeAIKernel();
  const provider = new ClaudeResearchProvider(kernel);
  const researchAgent = new ResearchAgent(provider);

  const topic: Topic = {
    title: "Artificial Intelligence in Healthcare",
    angle: "how AI is changing patient care, explained in 60 seconds",
    keywords: ["AI", "healthcare", "diagnosis", "patient care"],
  };
  const pipeline: PipelineData = createPipelineData({ topic });

  const context: WorkflowContext = withWorkflowState(
    {
      correlationId: newCorrelationId("research-demo"),
      executionId: newCorrelationId("exec"),
      state: WorkflowState.Pending,
      niche: "tech-news",
      logger,
      runtime: runtimeConfig,
      startedAt: new Date().toISOString(),
    },
    WorkflowState.Researching,
  );

  const result = await researchAgent.run(context, pipeline);

  if (!result.success) {
    logger.error("Research stage failed", { errors: result.errors });
    process.exitCode = 1;
    return;
  }

  const research = result.pipelineData.research;
  const detail = provider.lastResult; // rich result (references, warnings, usage, latency)

  console.log("\n=== ResearchAgent → AI Kernel → Claude ===");
  console.log("Provider:", provider.name);

  console.log("\n--- Summary ---");
  console.log(research?.summary ?? "(none)");

  console.log("\n--- Key Points ---");
  for (const point of research?.keyPoints ?? []) {
    console.log(" •", point);
  }

  console.log("\n--- References ---");
  if ((research?.sources.length ?? 0) === 0) {
    console.log(" (none returned by the model)");
  } else {
    for (const source of research?.sources ?? []) {
      console.log(" -", source.url ? `${source.title} (${source.url})` : source.title);
    }
  }

  if (detail) {
    console.log("\n--- Token Usage ---");
    console.log(JSON.stringify(detail.metadata.tokenUsage));
    console.log("\n--- Latency ---");
    console.log(`${detail.metadata.latencyMs} ms`);
    if (detail.warnings.length > 0) {
      console.log("\n--- Warnings ---");
      for (const warning of detail.warnings) {
        console.log(" !", warning);
      }
    }
  }
}

main().catch((error: unknown) => {
  logger.error("Research demo failed", { error: String(error) });
  process.exitCode = 1;
});
