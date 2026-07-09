/**
 * Decision demo — proves the active DecisionEngine loop (Step 13).
 *
 * Three scenarios show the decision history the Brain produces:
 *   1. every node succeeds        → Proceed, Proceed, Proceed
 *   2. a node permanently fails   → Proceed, Abort
 *   3. a skippable node fails      → Proceed, Skip, Proceed
 *
 * All mock; no real AI/network. A fast retry delay (10ms) keeps it quick.
 *
 *   npm run demo:decision
 */
import { InMemoryAgentRegistry } from "../core/agent-registry.js";
import { AgentLifecycle } from "../core/lifecycle/agent-lifecycle.js";
import type { WorkflowContext } from "../core/workflow-context.js";
import type { PipelineData } from "../pipeline/pipeline-data.js";
import { RetryableError } from "../lib/errors.js";
import { ResearchAgent } from "../agents/research/research-agent.js";
import { ScriptAgent } from "../agents/script/script-agent.js";
import { VoiceAgent } from "../agents/voice/voice-agent.js";
import { MockResearchProvider } from "../providers/research/mock-research-provider.js";
import { MockScriptProvider } from "../providers/script/mock-script-provider.js";
import { MockVoiceProvider } from "../providers/voice/mock-voice-provider.js";
import {
  Brain,
  SimplePlanner,
  DefaultDecisionEngine,
  DefaultPolicyEngine,
  NonEmptyPlanPolicy,
  RegisteredAgentsPolicy,
  MaxStepsPolicy,
  SequentialExecutionStrategy,
  AgentNodeExecutor,
  FixedRetryPolicy,
  DEFAULT_POLICY_CONFIG,
} from "../brain/index.js";
import type { BrainGoal, ExecutionResult } from "../brain/index.js";
import { DefaultRuntimeKernel } from "../runtime/index.js";
import { newCorrelationId } from "../lib/correlation.js";
import { logger } from "../lib/logger.js";

/** A temporary agent (registered under a chosen name) that always fails. */
class FailingAgent extends AgentLifecycle {
  constructor(readonly name: string) {
    super();
  }
  protected async execute(_context: WorkflowContext, _data: PipelineData): Promise<PipelineData> {
    throw new RetryableError(`${this.name}: simulated permanent failure`);
  }
}

/** Build a Brain via DI with a FAST retry policy (10ms) so the demo is quick. */
function buildBrain(registry: InMemoryAgentRegistry<AgentLifecycle>): Brain {
  const decisionEngine = new DefaultDecisionEngine(DEFAULT_POLICY_CONFIG);
  const strategy = new SequentialExecutionStrategy(
    new AgentNodeExecutor(registry, new FixedRetryPolicy(3, 10)),
    decisionEngine,
  );
  return new Brain({
    planner: new SimplePlanner(registry),
    policyEngine: new DefaultPolicyEngine(DEFAULT_POLICY_CONFIG, [
      new NonEmptyPlanPolicy(),
      new RegisteredAgentsPolicy(registry),
      new MaxStepsPolicy(),
    ]),
    runtimeKernel: new DefaultRuntimeKernel(strategy),
  });
}

function baseGoal(): BrainGoal {
  return {
    id: newCorrelationId("goal"),
    description: "Create a 60-second AI video about renewable energy",
    topicTitle: "Renewable energy breakthroughs in 2026",
    niche: "tech-news",
    platforms: ["youtube", "tiktok"],
  };
}

function report(label: string, result: ExecutionResult): void {
  console.log(`\n########## ${label} ##########`);
  console.log("Decision history:");
  for (const decision of result.decisionHistory) {
    console.log(`  - ${decision.kind}  (${decision.nodeId ?? "-"})  — ${decision.reason}`);
  }
  console.log("Decision events:", result.context.getEvents().filter((e) => e.type.startsWith("Decision")).map((e) => e.type).join(", "));
  console.log(
    "Result:",
    JSON.stringify({ status: result.status, completed: result.completedNodes, failed: result.failedNodes }),
  );
}

async function main(): Promise<void> {
  // Scenario 1 — every node succeeds.
  const reg1 = new InMemoryAgentRegistry<AgentLifecycle>();
  reg1.register(new ResearchAgent(new MockResearchProvider()));
  reg1.register(new ScriptAgent(new MockScriptProvider()));
  reg1.register(new VoiceAgent(new MockVoiceProvider()));
  report("SCENARIO 1 — every node succeeds", await buildBrain(reg1).execute(baseGoal()));

  // Scenario 2 — a node permanently fails (script-agent, not skippable).
  const reg2 = new InMemoryAgentRegistry<AgentLifecycle>();
  reg2.register(new ResearchAgent(new MockResearchProvider()));
  reg2.register(new FailingAgent("script-agent"));
  reg2.register(new VoiceAgent(new MockVoiceProvider()));
  report("SCENARIO 2 — a node permanently fails", await buildBrain(reg2).execute(baseGoal()));

  // Scenario 3 — a skippable node fails and is skipped.
  const reg3 = new InMemoryAgentRegistry<AgentLifecycle>();
  reg3.register(new ResearchAgent(new MockResearchProvider()));
  reg3.register(new FailingAgent("enrichment-agent"));
  reg3.register(new ScriptAgent(new MockScriptProvider()));
  const skipGoal: BrainGoal = {
    ...baseGoal(),
    requestedAgents: ["research-agent", "enrichment-agent", "script-agent"],
    skippableAgents: ["enrichment-agent"],
  };
  report("SCENARIO 3 — a skippable node fails (skipped)", await buildBrain(reg3).execute(skipGoal));
}

main().catch((error: unknown) => {
  logger.error("Decision demo failed", { error: String(error) });
  process.exitCode = 1;
});
