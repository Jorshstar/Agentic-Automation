/**
 * Pipeline demo — a tiny, runnable demonstration (NOT a Trigger.dev task).
 *
 * It chains the first two agents over one shared pipeline:
 *
 *   ResearchAgent → ScriptAgent → VoiceAgent
 *
 * ...printing the PipelineData after each stage. All agents use MOCK providers
 * (no real AI, no network, no API keys). Run it with:
 *
 *   npm run demo:research
 */
import { ResearchAgent } from "../agents/research/research-agent.js";
import { ScriptAgent } from "../agents/script/script-agent.js";
import { VoiceAgent } from "../agents/voice/voice-agent.js";
import { MockResearchProvider } from "../providers/research/mock-research-provider.js";
import { MockScriptProvider } from "../providers/script/mock-script-provider.js";
import { MockVoiceProvider } from "../providers/voice/mock-voice-provider.js";
import { InMemoryAgentRegistry } from "../core/agent-registry.js";
import type { AgentLifecycle } from "../core/lifecycle/agent-lifecycle.js";
import type { AgentResult } from "../core/lifecycle/agent-result.js";
import type { WorkflowContext } from "../core/workflow-context.js";
import { withWorkflowState } from "../core/workflow-context.js";
import { WorkflowState } from "../core/workflow-state.js";
import { createPipelineData } from "../pipeline/pipeline-builder.js";
import type { PipelineData } from "../pipeline/pipeline-data.js";
import type { Topic } from "../pipeline/models/topic.js";
import { newCorrelationId } from "../lib/correlation.js";
import { logger } from "../lib/logger.js";
import { runtimeConfig } from "../config/runtime.js";

/** Print one stage's result + the resulting pipeline. */
function printStage(label: string, result: AgentResult): void {
  console.log(`\n=== ${label} → AgentResult ===`);
  console.log(
    JSON.stringify(
      {
        success: result.success,
        durationMs: result.durationMs,
        warnings: result.warnings,
        errors: result.errors,
        metrics: result.metrics,
      },
      null,
      2,
    ),
  );
  console.log(`\n=== ${label} → PipelineData ===`);
  console.log(JSON.stringify(result.pipelineData, null, 2));
}

async function main(): Promise<void> {
  // Dependency injection + registration: both agents built with MOCK providers.
  const registry = new InMemoryAgentRegistry<AgentLifecycle>();
  registry.register(new ResearchAgent(new MockResearchProvider()));
  registry.register(new ScriptAgent(new MockScriptProvider()));
  registry.register(new VoiceAgent(new MockVoiceProvider()));

  // Start the shared pipeline with a topic.
  const topic: Topic = {
    title: "Why the ocean glows at night",
    angle: "bioluminescent plankton, explained in 60 seconds",
    keywords: ["bioluminescence", "ocean", "plankton"],
  };
  let pipeline: PipelineData = createPipelineData({ topic });

  const baseContext: WorkflowContext = {
    correlationId: newCorrelationId("studio-demo"),
    executionId: newCorrelationId("exec"),
    state: WorkflowState.Pending,
    niche: "scary-stories",
    logger,
    runtime: runtimeConfig,
    startedAt: new Date().toISOString(),
  };

  // --- Stage 1: Research ---
  const researchAgent = registry.resolve("research-agent");
  const researchResult = await researchAgent.run(
    withWorkflowState(baseContext, WorkflowState.Researching),
    pipeline,
  );
  printStage("Research", researchResult);
  if (!researchResult.success) {
    logger.error("Stopping: research stage failed");
    process.exitCode = 1;
    return;
  }
  pipeline = researchResult.pipelineData;

  // --- Stage 2: Script (depends on Research) ---
  const scriptAgent = registry.resolve("script-agent");
  const scriptResult = await scriptAgent.run(
    withWorkflowState(baseContext, WorkflowState.ScriptWriting),
    pipeline,
  );
  printStage("Script", scriptResult);
  if (!scriptResult.success) {
    logger.error("Stopping: script stage failed");
    process.exitCode = 1;
    return;
  }
  pipeline = scriptResult.pipelineData;

  // --- Stage 3: Voiceover (depends on Script) ---
  const voiceAgent = registry.resolve("voice-agent");
  const voiceResult = await voiceAgent.run(
    withWorkflowState(baseContext, WorkflowState.VoiceGeneration),
    pipeline,
  );
  printStage("Voice", voiceResult);
  if (!voiceResult.success) {
    logger.error("Stopping: voice stage failed");
    process.exitCode = 1;
    return;
  }
  pipeline = voiceResult.pipelineData;

  logger.info("Pipeline demo finished", {
    hasResearch: pipeline.research !== undefined,
    hasScript: pipeline.script !== undefined,
    hasVoiceover: pipeline.voiceover !== undefined,
  });
}

main().catch((error: unknown) => {
  logger.error("Pipeline demo failed", { error: String(error) });
  process.exitCode = 1;
});
