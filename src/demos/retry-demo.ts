/**
 * Retry demo — proves the NodeExecutor's retry engine (Step 12).
 *
 * It defines two TEMPORARY mock agents (registered as "script-agent"):
 *   1. a flaky one that fails twice then succeeds,
 *   2. one that always fails.
 *
 * The ExecutionStrategy is unaware of retries — it just sees each node complete
 * or fail. All mock; no real AI, no network. A fast retry delay (10ms) keeps it
 * quick.
 *
 *   npm run demo:retry
 */
import { InMemoryAgentRegistry } from "../core/agent-registry.js";
import { AgentLifecycle } from "../core/lifecycle/agent-lifecycle.js";
import type { WorkflowContext } from "../core/workflow-context.js";
import type { PipelineData } from "../pipeline/pipeline-data.js";
import { setSection } from "../pipeline/pipeline-update.js";
import type { Script } from "../pipeline/models/script.js";
import { RetryableError } from "../lib/errors.js";
import { ResearchAgent } from "../agents/research/research-agent.js";
import { VoiceAgent } from "../agents/voice/voice-agent.js";
import { MockResearchProvider } from "../providers/research/mock-research-provider.js";
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
import type { BrainGoal } from "../brain/index.js";
import { DefaultRuntimeKernel } from "../runtime/index.js";
import { newCorrelationId } from "../lib/correlation.js";
import { logger } from "../lib/logger.js";

const SCRIPT_NODE_ID = "node-2-script-agent";

/** Produce a minimal valid script so a following VoiceAgent can run. */
function buildScript(): Script {
  const body = "This is a simulated script body used to prove the retry engine works end to end.";
  return {
    title: "Retry demo script",
    hook: "Watch this.",
    body,
    callToAction: "Follow for more.",
    wordCount: body.split(/\s+/u).length,
    estimatedDurationSeconds: 8,
  };
}

/** Fails `failuresBeforeSuccess` times, then succeeds. Registered as script-agent. */
class FlakyScriptAgent extends AgentLifecycle {
  readonly name = "script-agent";
  private attempts = 0;
  constructor(private readonly failuresBeforeSuccess: number) {
    super();
  }
  protected async execute(_context: WorkflowContext, data: PipelineData): Promise<PipelineData> {
    this.attempts += 1;
    if (this.attempts <= this.failuresBeforeSuccess) {
      throw new RetryableError(`FlakyScriptAgent: simulated failure on attempt ${this.attempts}`);
    }
    return setSection(data, "script", buildScript());
  }
}

/** Always fails. Registered as script-agent. */
class AlwaysFailScriptAgent extends AgentLifecycle {
  readonly name = "script-agent";
  private attempts = 0;
  protected async execute(_context: WorkflowContext, _data: PipelineData): Promise<PipelineData> {
    this.attempts += 1;
    throw new RetryableError(`AlwaysFailScriptAgent: simulated failure on attempt ${this.attempts}`);
  }
}

/** Build a Brain via DI with a FAST retry policy (10ms) so the demo is quick. */
function buildBrain(registry: InMemoryAgentRegistry<AgentLifecycle>): Brain {
  const decisionEngine = new DefaultDecisionEngine();
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

function goal(): BrainGoal {
  return {
    id: newCorrelationId("goal"),
    description: "Create a 60-second AI video about renewable energy",
    topicTitle: "Renewable energy breakthroughs in 2026",
    niche: "tech-news",
    platforms: ["youtube", "tiktok"],
  };
}

async function scenarioFlaky(): Promise<void> {
  console.log("\n########## SCENARIO 1 — fails twice, then succeeds ##########");
  const registry = new InMemoryAgentRegistry<AgentLifecycle>();
  registry.register(new ResearchAgent(new MockResearchProvider()));
  registry.register(new FlakyScriptAgent(2)); // registered as "script-agent"
  registry.register(new VoiceAgent(new MockVoiceProvider()));

  const result = await buildBrain(registry).execute(goal());

  console.log("\nScript-node event sequence:");
  for (const event of result.context.getEvents().filter((e) => e.stepId === SCRIPT_NODE_ID)) {
    const attempt = typeof event.data?.attempt === "number" ? ` (attempt ${event.data.attempt})` : "";
    console.log(`  - ${event.type}${attempt}`);
  }

  console.log("\nResult:");
  console.log(
    JSON.stringify(
      {
        status: result.status,
        completedNodes: result.completedNodes.length,
        failedNodes: result.failedNodes.length,
        hasScript: result.pipelineData.script !== undefined,
        hasVoiceover: result.pipelineData.voiceover !== undefined,
      },
      null,
      2,
    ),
  );
}

async function scenarioAlwaysFail(): Promise<void> {
  console.log("\n########## SCENARIO 2 — always fails ##########");
  const registry = new InMemoryAgentRegistry<AgentLifecycle>();
  registry.register(new ResearchAgent(new MockResearchProvider()));
  registry.register(new AlwaysFailScriptAgent()); // registered as "script-agent"
  registry.register(new VoiceAgent(new MockVoiceProvider()));

  const result = await buildBrain(registry).execute(goal());

  console.log("\nScript-node event sequence:");
  for (const event of result.context.getEvents().filter((e) => e.stepId === SCRIPT_NODE_ID)) {
    const attempt = typeof event.data?.attempt === "number" ? ` (attempt ${event.data.attempt})` : "";
    console.log(`  - ${event.type}${attempt}`);
  }

  console.log("\nResult:");
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
}

async function main(): Promise<void> {
  await scenarioFlaky();
  await scenarioAlwaysFail();
}

main().catch((error: unknown) => {
  logger.error("Retry demo failed", { error: String(error) });
  process.exitCode = 1;
});
