import { AgentLifecycle } from "../../core/lifecycle/agent-lifecycle.js";
import type { WorkflowContext } from "../../core/workflow-context.js";
import type { PipelineData } from "../../pipeline/pipeline-data.js";
import { setSection } from "../../pipeline/pipeline-update.js";
import type { Research } from "../../pipeline/models/research.js";
import { ValidationError } from "../../lib/errors.js";
import type { ResearchProvider } from "../../providers/research/research-provider.js";

/**
 * ResearchAgent — the first real agent.
 *
 * It extends {@link AgentLifecycle}, so it inherits the whole execution skeleton
 * (timing, error handling, result building) and only has to implement `execute`.
 *
 * Crucially, it depends on the `ResearchProvider` INTERFACE, which is handed in
 * through the constructor (dependency injection). The agent never creates a
 * provider itself, so the mock can be swapped for a real AI provider later with
 * zero changes here.
 */
export class ResearchAgent extends AgentLifecycle {
  readonly name = "research-agent";

  constructor(private readonly provider: ResearchProvider) {
    super();
  }

  protected async execute(
    context: WorkflowContext,
    data: PipelineData,
  ): Promise<PipelineData> {
    // Read the input section the agent needs.
    const topic = data.topic;
    if (!topic) {
      throw new ValidationError("ResearchAgent requires PipelineData.topic to be set");
    }

    // Ask the provider to validate the topic before doing real work.
    const validation = await this.provider.validateTopic(topic.title);
    if (!validation.valid) {
      throw new ValidationError(
        `Topic failed validation: ${validation.issues.join("; ")}`,
      );
    }

    context.logger.info("ResearchAgent: researching topic", {
      topic: topic.title,
      provider: this.provider.name,
    });

    // Call the provider INTERFACE — not any specific AI service.
    const result = await this.provider.researchTopic({
      topic: topic.title,
      angle: topic.angle,
      keywords: topic.keywords,
    });

    // Map the provider's response into the pipeline's Research section.
    const research: Research = {
      summary: result.summary,
      keyPoints: result.keyPoints,
      sources: result.sources,
    };

    context.logger.info("ResearchAgent: research complete", {
      keyPoints: research.keyPoints.length,
      sources: research.sources.length,
      confidence: result.confidence,
    });

    // Return an UPDATED COPY of the pipeline (immutable update).
    return setSection(data, "research", research);
  }
}
