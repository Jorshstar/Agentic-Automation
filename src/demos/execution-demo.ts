/**
 * Execution demo — the Brain EXECUTES a goal end-to-end (Step 9).
 *
 * It registers the three agents, builds a Brain, and calls `brain.execute(goal)`.
 * The Brain delegates to an ExecutionStrategy (the default is
 * SequentialExecutionStrategy), which walks the plan graph one node at a time —
 * Research → Script → Voice — resolving each agent from the registry and running
 * it. All agents use MOCK providers: no real AI, no network, no files.
 *
 * Path:  Brain → ExecutionStrategy → SequentialExecutionStrategy → Agents
 *
 *   npm run demo:execution
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
  // 1. Register the agents the Brain may orchestrate.
  const registry = new InMemoryAgentRegistry<AgentLifecycle>();
  registry.register(new ResearchAgent(new MockResearchProvider()));
  registry.register(new ScriptAgent(new MockScriptProvider()));
  registry.register(new VoiceAgent(new MockVoiceProvider()));

  // 2. Build the Brain (thinks) around the runtime kernel (executes).
  const brain = createDefaultBrain(registry, createDefaultRuntime(registry));

  // 3. Execute one goal end-to-end.
  const goal: BrainGoal = {
    id: newCorrelationId("goal"),
    description: "Create a 60-second AI video about renewable energy",
    topicTitle: "Renewable energy breakthroughs in 2026",
    niche: "tech-news",
    platforms: ["youtube", "tiktok"],
  };

  const result = await brain.execute(goal);
  const context = result.context;

  // --- Execution strategy actually used (recorded by the strategy) ---
  console.log("\n=== Execution path ===");
  console.log(`Brain → ExecutionStrategy → ${String(context.getVariable("strategy"))} → Agents`);

  // --- Execution order (from the append-only event log) ---
  console.log("\n=== Execution order (NodeCompleted events) ===");
  const order = context
    .getEvents()
    .filter((event) => event.type === "NodeCompleted")
    .map((event, index) => `${index + 1}. ${String(event.data?.agentName)} (${event.stepId})`);
  console.log(order.join("\n"));

  // --- Final node states ---
  console.log("\n=== Node states ===");
  console.log(JSON.stringify(context.getNodeStates(), null, 2));

  // --- Full event log (append-only) ---
  console.log("\n=== Execution events (append-only log) ===");
  console.log(JSON.stringify(context.getEvents(), null, 2));

  // --- Final PipelineData ---
  console.log("\n=== Final PipelineData ===");
  console.log(JSON.stringify(result.pipelineData, null, 2));

  // --- Final result summary ---
  console.log("\n=== Execution result ===");
  console.log(
    JSON.stringify(
      {
        status: result.status,
        completedNodes: result.completedNodes,
        failedNodes: result.failedNodes,
      },
      null,
      2,
    ),
  );

  logger.info("Execution demo finished", {
    status: result.status,
    completed: result.completedNodes.length,
    failed: result.failedNodes.length,
  });
}

main().catch((error: unknown) => {
  logger.error("Execution demo failed", { error: String(error) });
  process.exitCode = 1;
});
