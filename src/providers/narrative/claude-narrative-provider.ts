import type { AIKernel, AIGenerateRequest } from "../../ai/index.js";
import type { ContentPlan } from "../content-planning/index.js";
import type { NarrativeProvider } from "./narrative-provider.js";
import type {
  NarrativeContext,
  NarrativeRequest,
  NarrativeScript,
  NarrativeSegment,
  NarrativeMetadata,
} from "./types.js";

/**
 * ClaudeNarrativeProvider — turns a ContentPlan into a timed NarrativeScript.
 *
 * Its ONLY route to AI is `AIKernel.generate()`. It never imports the Anthropic
 * SDK, never writes a prompt string (it selects the managed prompt by id), never
 * names a model (the prompt's metadata does), and never makes an HTTP call.
 *
 *   ContentPlan → NarrativeProvider (this) → AIKernel.generate() → Claude
 *              → parsed NarrativeScript
 *
 * NOTE ON PROMPTS: the current AI Kernel sends ONE prompt per call (rendered as
 * the user message), so this provider drives `narrative.user` — a self-contained
 * instruction. Its companion `narrative.system` is registered in Prompt
 * Management as the system-role prompt and will attach as a separate system
 * message once the kernel supports that, with no change here.
 */

/** The prompt this provider drives. The TEXT lives in the Prompt Management System. */
const NARRATIVE_PROMPT_ID = "narrative.user";
/** Role + rules (the scriptwriter persona), sent as the system instruction. */
const NARRATIVE_SYSTEM_PROMPT_ID = "narrative.system";

/** Sensible defaults for the production context the ContentPlan doesn't carry. */
const DEFAULT_NARRATIVE_CONTEXT: NarrativeContext = {
  language: "English",
  platform: "YouTube Shorts",
  targetDurationSeconds: 65,
};

export class ClaudeNarrativeProvider implements NarrativeProvider {
  readonly name = "claude-narrative-provider";

  private lastScript: NarrativeScript | undefined;

  constructor(
    private readonly kernel: AIKernel,
    private readonly context: NarrativeContext = DEFAULT_NARRATIVE_CONTEXT,
  ) {}

  /** The most recent script produced (handy for demos/telemetry). */
  get lastResult(): NarrativeScript | undefined {
    return this.lastScript;
  }

  async narrate(request: NarrativeRequest): Promise<NarrativeScript> {
    const context: NarrativeContext = { ...this.context, ...request.context };
    const plan = request.contentPlan;
    // Authoritative target is the RUN setting — the content plan's own duration
    // estimate is unreliable and would scale the word budget (and video length)
    // all over the place.
    const targetDuration = context.targetDurationSeconds;

    const generateRequest: AIGenerateRequest = {
      promptId: NARRATIVE_PROMPT_ID,
      systemPromptId: context.systemPromptId ?? NARRATIVE_SYSTEM_PROMPT_ID,
      variables: {
        hook: plan.hook,
        coreMessage: plan.coreMessage,
        tone: plan.tone,
        targetAudience: plan.targetAudience,
        sections: serializeSections(plan),
        callToAction: plan.callToAction,
        targetDurationSeconds: targetDuration,
        // Word RANGE so the video lands in its duration window. The CALLER owns
        // this budget: it knows the niche's real speaking rate. Hardcoding it
        // here once made the prompt ask for 166 words while the runner's gate
        // demanded 134 — six wasted retries and a sped-up narration.
        minWords: context.minWords ?? Math.round(targetDuration * 2.4),
        maxWords: context.maxWords ?? Math.round(targetDuration * 2.55),
        // ~5s per scene: one sentence each, captions/visuals locked to the voice.
        minSegments: context.minSegments ?? Math.max(6, Math.round(targetDuration / 6)),
        maxSegments: context.maxSegments ?? Math.max(9, Math.round(targetDuration / 4.5)),
        platform: context.platform,
        language: context.language,
      },
      expectedOutput: { format: "json", description: "a timed narration script" },
      maxTokens: 1800,
    };

    const generated = await this.kernel.generate<string>(generateRequest);

    const metadata: NarrativeMetadata = {
      promptId: generated.promptId,
      promptVersion: generated.promptVersion,
      provider: generated.provider,
      model: generated.model,
      tokenUsage: {
        inputTokens: generated.usage.inputTokens,
        outputTokens: generated.usage.outputTokens,
        totalTokens: generated.usage.totalTokens,
      },
      latencyMs: generated.latencyMs,
    };

    const script = parseNarrativeScript(generated.output, targetDuration, metadata);
    this.lastScript = script;
    return script;
  }
}

/** Flatten the plan's sections into a compact, ordered brief for the prompt. */
function serializeSections(plan: ContentPlan): string {
  return plan.sections
    .map((section, index) => {
      const points = section.keyPoints.length > 0 ? section.keyPoints.join("; ") : "—";
      return (
        `${index + 1}. ${section.title} (${section.durationSeconds}s) — ${section.purpose}\n` +
        `   Points: ${points}`
      );
    })
    .join("\n");
}

/**
 * Parse the model's JSON into a strongly-typed NarrativeScript. Defensive:
 * strips fences, tolerates missing fields (recording warnings), coerces types,
 * and flags an obviously-wrong total duration.
 */
function parseNarrativeScript(
  raw: string,
  targetDuration: number,
  metadata: NarrativeMetadata,
): NarrativeScript {
  const warnings: string[] = [];
  const root = parseJsonObject(raw, warnings);

  const segments = asSegmentArray(root["segments"], warnings);
  if (segments.length === 0) {
    warnings.push("No segments were parsed from the model output.");
  }

  const estimatedDurationSeconds = asNumber(
    root["estimatedDurationSeconds"],
    segments.length > 0 ? (segments[segments.length - 1]?.endSecond ?? targetDuration) : targetDuration,
  );

  // Sanity check the timeline against the target (±25%).
  if (
    estimatedDurationSeconds > 0 &&
    Math.abs(estimatedDurationSeconds - targetDuration) > targetDuration * 0.25
  ) {
    warnings.push(
      `Estimated duration (${estimatedDurationSeconds}s) is far from the target (${targetDuration}s).`,
    );
  }

  return {
    hook: requireString(root["hook"], "hook", warnings),
    segments,
    callToAction: requireString(root["callToAction"], "callToAction", warnings),
    estimatedDurationSeconds,
    warnings,
    metadata,
  };
}

/** Strip markdown fences / prose and JSON.parse the first object found. */
function parseJsonObject(raw: string, warnings: string[]): Record<string, unknown> {
  const withoutFences = raw.replace(/```(?:json)?/giu, "").trim();
  const start = withoutFences.indexOf("{");
  const end = withoutFences.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    warnings.push("Model output did not contain a JSON object.");
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(withoutFences.slice(start, end + 1));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    warnings.push("Model output JSON was not an object.");
    return {};
  } catch {
    warnings.push("Model output was not valid JSON.");
    return {};
  }
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function requireString(value: unknown, field: string, warnings: string[]): string {
  if (typeof value === "string" && value.trim() !== "") {
    return value;
  }
  warnings.push(`Missing or empty field: "${field}".`);
  return "";
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asSegmentArray(value: unknown, warnings: string[]): readonly NarrativeSegment[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const segments: NarrativeSegment[] = [];
  for (const entry of value) {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const record = entry as Record<string, unknown>;
      segments.push({
        startSecond: asNumber(record["startSecond"], 0),
        endSecond: asNumber(record["endSecond"], 0),
        text: asString(record["text"], ""),
        emotion: asString(record["emotion"], "neutral"),
        visualHint: asString(record["visualHint"], ""),
        stockKeyword: asString(record["stockKeyword"], ""),
      });
    } else {
      warnings.push("Skipped a malformed segment entry.");
    }
  }
  return segments;
}
