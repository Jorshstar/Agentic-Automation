/**
 * Brain demo — the minimal example: build a Brain and run one goal.
 *
 * As of Step 9, `brain.execute(goal)` actually EXECUTES the plan (Research →
 * Script → Voice) using the registered agents and returns an ExecutionResult.
 * All agents use MOCK providers (no real AI, no network, no API keys).
 *
 *   npm run demo:brain
 */
import { InMemoryAgentRegistry } from "../core/agent-registry.js";
import type { AgentLifecycle } from "../core/lifecycle/agent-lifecycle.js";
import { ResearchAgent } from "../agents/research/research-agent.js";
import { ScriptAgent } from "../agents/script/script-agent.js";
import { VoiceAgent } from "../agents/voice/voice-agent.js";
import { MockResearchProvider } from "../providers/research/mock-research-provider.js";
import { MockScriptProvider } from "../providers/script/mock-script-provider.js";
import { MockVoiceProvider } from "../providers/voice/mock-voice-provider.js";
import { createDefaultBrain } from "../brain/brain.js";
import { createDefaultRuntime } from "../runtime/index.js";
import type { BrainGoal } from "../brain/goal.js";
import { newCorrelationId } from "../lib/correlation.js";
import { logger } from "../lib/logger.js";

async function main(): Promise<void> {
  const registry = new InMemoryAgentRegistry<AgentLifecycle>();
  registry.register(new ResearchAgent(new MockResearchProvider()));
  registry.register(new ScriptAgent(new MockScriptProvider()));
  registry.register(new VoiceAgent(new MockVoiceProvider()));

  // The Brain thinks; the runtime kernel executes.
  const brain = createDefaultBrain(registry, createDefaultRuntime(registry));

  const goal: BrainGoal = {
    id: newCorrelationId("goal"),
    description: "Create a 60-second AI video about renewable energy",
    niche: "tech-news",
    platforms: ["youtube", "tiktok"],
  };

  const result = await brain.execute(goal);

  logger.info("Brain.execute finished", {
    status: result.status,
    completed: result.completedNodes,
    failed: result.failedNodes,
  });

  console.log("\n=== ExecutionContext ===");
  console.log(JSON.stringify(result.context, null, 2));
}

main().catch((error: unknown) => {
  logger.error("Brain demo failed", { error: String(error) });
  process.exitCode = 1;
});
