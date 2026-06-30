import { AgentLifecycle } from "../../core/lifecycle/agent-lifecycle.js";
import type { WorkflowContext } from "../../core/workflow-context.js";
import type { PipelineData } from "../../pipeline/pipeline-data.js";
import { setSection } from "../../pipeline/pipeline-update.js";
import type { Script } from "../../pipeline/models/script.js";
import { ValidationError } from "../../lib/errors.js";
import type { ScriptProvider } from "../../providers/script/script-provider.js";

/**
 * ScriptAgent — turns research into a 60-second script.
 *
 * Like the ResearchAgent, it extends {@link AgentLifecycle} (so it only writes
 * `execute`) and depends on a `ScriptProvider` INTERFACE injected through the
 * constructor — never on a concrete AI service.
 *
 * Script depends on Research: it reads `PipelineData.research`. If that section
 * is missing, it raises a `ValidationError`. The lifecycle CATCHES that and
 * turns it into an `AgentResult` with `success: false` — so calling `run()`
 * returns a clean failure result rather than throwing at the caller.
 */
export class ScriptAgent extends AgentLifecycle {
  readonly name = "script-agent";

  constructor(private readonly provider: ScriptProvider) {
    super();
  }

  protected async execute(
    context: WorkflowContext,
    data: PipelineData,
  ): Promise<PipelineData> {
    // Script depends on Research — fail cleanly (via the lifecycle) if missing.
    const research = data.research;
    if (!research) {
      throw new ValidationError(
        "ScriptAgent requires PipelineData.research (run ResearchAgent first)",
      );
    }

    const topic = data.topic;
    const topicTitle = topic?.title ?? "Untitled topic";

    context.logger.info("ScriptAgent: generating script", {
      topic: topicTitle,
      provider: this.provider.name,
    });

    // Call the provider INTERFACE.
    const generated = await this.provider.generateScript({
      topic: topicTitle,
      angle: topic?.angle,
      summary: research.summary,
      keyPoints: research.keyPoints,
      keywords: topic?.keywords,
      targetDurationSeconds: 60,
    });

    // Sanity-check the length via the provider contract; log (not fail) on issues.
    const lengthCheck = await this.provider.validateLength({
      wordCount: generated.wordCount,
      targetDurationSeconds: generated.estimatedDurationSeconds,
    });
    if (!lengthCheck.valid) {
      context.logger.warn("ScriptAgent: length check raised issues", {
        issues: lengthCheck.issues,
      });
    }

    // Map the provider's richer output into the pipeline's Script section.
    const script: Script = {
      title: generated.title,
      hook: generated.hook,
      body: generated.body,
      callToAction: generated.callToAction,
      wordCount: generated.wordCount,
      estimatedDurationSeconds: generated.estimatedDurationSeconds,
    };

    context.logger.info("ScriptAgent: script generated", {
      wordCount: generated.wordCount,
      estimatedDurationSeconds: generated.estimatedDurationSeconds,
      language: generated.language,
      tone: generated.tone,
      targetAudience: generated.targetAudience,
    });

    return setSection(data, "script", script);
  }
}
