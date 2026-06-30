import { AgentLifecycle } from "../../core/lifecycle/agent-lifecycle.js";
import type { WorkflowContext } from "../../core/workflow-context.js";
import type { PipelineData } from "../../pipeline/pipeline-data.js";
import { setSection } from "../../pipeline/pipeline-update.js";
import type { Voiceover } from "../../pipeline/models/voiceover.js";
import { ValidationError } from "../../lib/errors.js";
import type { VoiceProvider } from "../../providers/voice/voice-provider.js";

/**
 * VoiceAgent — turns the script into voice DIRECTION (metadata only).
 *
 * Same pattern as the earlier agents: extends {@link AgentLifecycle} (implements
 * only `execute`) and depends on the injected `VoiceProvider` INTERFACE.
 *
 * It reads `PipelineData.script` and writes `PipelineData.voiceover`. If the
 * script is missing it raises a `ValidationError`; the lifecycle catches that and
 * returns an `AgentResult` with `success: false` (a clean failure, never a throw
 * to the caller). No audio, no files, no network.
 */
export class VoiceAgent extends AgentLifecycle {
  readonly name = "voice-agent";

  constructor(private readonly provider: VoiceProvider) {
    super();
  }

  protected async execute(
    context: WorkflowContext,
    data: PipelineData,
  ): Promise<PipelineData> {
    // Voice depends on Script — fail cleanly (via the lifecycle) if missing.
    const script = data.script;
    if (!script) {
      throw new ValidationError(
        "VoiceAgent requires PipelineData.script (run ScriptAgent first)",
      );
    }

    const narration = script.body;

    // Validate the narration via the provider contract.
    const validation = await this.provider.validateNarration(narration);
    if (!validation.valid) {
      throw new ValidationError(
        `Narration failed validation: ${validation.issues.join("; ")}`,
      );
    }

    context.logger.info("VoiceAgent: generating voice direction", {
      provider: this.provider.name,
      words: narration.split(/\s+/u).length,
    });

    // Call the provider INTERFACE (metadata only).
    const result = await this.provider.generateVoiceover({
      script: narration,
      title: script.title,
      targetDurationSeconds: 60,
    });

    // Map the provider's direction into the pipeline's Voiceover section.
    // `audioLocation` is intentionally omitted — no audio file at this stage.
    const voiceover: Voiceover = {
      narrationText: result.narrationText,
      speaker: result.speaker,
      voiceId: result.voiceId,
      language: result.language,
      speakingStyle: result.speakingStyle,
      speed: result.speed,
      pronunciationNotes: result.pronunciationNotes,
      pauses: result.pauses,
      emphasisMarkers: result.emphasisMarkers,
      durationSeconds: result.durationSeconds,
      estimatedAudioLengthSeconds: result.estimatedAudioLengthSeconds,
    };

    context.logger.info("VoiceAgent: voice direction ready", {
      speaker: result.speaker,
      voiceId: result.voiceId,
      estimatedAudioLengthSeconds: result.estimatedAudioLengthSeconds,
      pauses: result.pauses.length,
      emphasisMarkers: result.emphasisMarkers.length,
    });

    return setSection(data, "voiceover", voiceover);
  }
}
