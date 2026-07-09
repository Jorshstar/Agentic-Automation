import type { AIKernel, AIGenerateRequest } from "../../ai/index.js";
import type { NarrativeScript } from "../narrative/index.js";
import type { VisualDirectionProvider } from "./visual-direction-provider.js";
import type {
  VisualAssetType,
  VisualDirectionContext,
  VisualDirectionRequest,
  VisualDirectionPlan,
  VisualDirectionSegment,
  VisualDirectionMetadata,
} from "./types.js";
import { VISUAL_ASSET_TYPES } from "./types.js";

/**
 * ClaudeVisualDirectionProvider — turns a NarrativeScript into a
 * VisualDirectionPlan (per-segment art direction).
 *
 * Its ONLY route to AI is `AIKernel.generate()`. It never imports the Anthropic
 * SDK, never writes a prompt string (it selects the managed prompt by id), never
 * names a model (the prompt's metadata does), and never makes an HTTP call.
 *
 *   NarrativeScript → VisualDirectionProvider (this) → AIKernel.generate() → Claude
 *                  → parsed VisualDirectionPlan
 *
 * NOTE ON PROMPTS: the current AI Kernel sends ONE prompt per call (rendered as
 * the user message), so this provider drives `visual-direction.user` — a
 * self-contained instruction. Its companion `visual-direction.system` is
 * registered in Prompt Management as the system-role prompt and will attach as a
 * separate system message once the kernel supports that, with no change here.
 */

/** The prompt this provider drives. The TEXT lives in the Prompt Management System. */
const VISUAL_DIRECTION_PROMPT_ID = "visual-direction.user";

/** Sensible defaults for the context the narrative timeline doesn't carry. */
const DEFAULT_VISUAL_DIRECTION_CONTEXT: VisualDirectionContext = {
  platform: "YouTube Shorts",
  overallVisualStyle: "Clean, modern, high-contrast visuals with bold on-screen text.",
};

/** The id given to the Nth narration segment (stable, order-preserving). */
function segmentId(index: number): string {
  return `seg-${index + 1}`;
}

export class ClaudeVisualDirectionProvider implements VisualDirectionProvider {
  readonly name = "claude-visual-direction-provider";

  private lastPlan: VisualDirectionPlan | undefined;

  constructor(
    private readonly kernel: AIKernel,
    private readonly context: VisualDirectionContext = DEFAULT_VISUAL_DIRECTION_CONTEXT,
  ) {}

  /** The most recent plan produced (handy for demos/telemetry). */
  get lastResult(): VisualDirectionPlan | undefined {
    return this.lastPlan;
  }

  async direct(request: VisualDirectionRequest): Promise<VisualDirectionPlan> {
    const context: VisualDirectionContext = { ...this.context, ...request.context };
    const narrativeSegmentCount = request.narrative.segments.length;

    const generateRequest: AIGenerateRequest = {
      promptId: VISUAL_DIRECTION_PROMPT_ID,
      variables: {
        segments: serializeSegments(request.narrative),
        platform: context.platform,
        overallVisualStyle: context.overallVisualStyle,
      },
      expectedOutput: { format: "json", description: "a per-segment visual direction plan" },
      maxTokens: 2000,
    };

    const generated = await this.kernel.generate<string>(generateRequest);

    const metadata: VisualDirectionMetadata = {
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

    const plan = parseVisualDirection(generated.output, narrativeSegmentCount, metadata);
    this.lastPlan = plan;
    return plan;
  }
}

/** Serialize the narration segments into an ordered, id-tagged brief for the prompt. */
function serializeSegments(narrative: NarrativeScript): string {
  return narrative.segments
    .map((segment, index) => {
      return (
        `${segmentId(index)}: [${segment.startSecond}s-${segment.endSecond}s] ` +
        `(${segment.emotion}) "${segment.text}"\n` +
        `   visual hint: ${segment.visualHint || "—"}`
      );
    })
    .join("\n");
}

/**
 * Parse the model's JSON into a strongly-typed VisualDirectionPlan. Defensive:
 * strips fences, tolerates missing fields (warnings), coerces the asset type to
 * the allowed set, and flags a segment-count mismatch vs the narration.
 */
function parseVisualDirection(
  raw: string,
  expectedSegmentCount: number,
  metadata: VisualDirectionMetadata,
): VisualDirectionPlan {
  const warnings: string[] = [];
  const root = parseJsonObject(raw, warnings);

  const segments = asDirectionSegmentArray(root["segments"], warnings);
  if (segments.length === 0) {
    warnings.push("No segments were parsed from the model output.");
  } else if (segments.length !== expectedSegmentCount) {
    warnings.push(
      `Segment count (${segments.length}) does not match the narration (${expectedSegmentCount}).`,
    );
  }

  return { segments, warnings, metadata };
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

function asAssetType(value: unknown, warnings: string[]): VisualAssetType {
  if (typeof value === "string" && (VISUAL_ASSET_TYPES as readonly string[]).includes(value)) {
    return value as VisualAssetType;
  }
  warnings.push(`Unknown assetType "${String(value)}", defaulting to "mixed".`);
  return "mixed";
}

function asDirectionSegmentArray(
  value: unknown,
  warnings: string[],
): readonly VisualDirectionSegment[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const segments: VisualDirectionSegment[] = [];
  value.forEach((entry, index) => {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const record = entry as Record<string, unknown>;
      segments.push({
        segmentId: asString(record["segmentId"], segmentId(index)),
        assetType: asAssetType(record["assetType"], warnings),
        cameraMovement: asString(record["cameraMovement"], ""),
        visualStyle: asString(record["visualStyle"], ""),
        colorMood: asString(record["colorMood"], ""),
        transition: asString(record["transition"], ""),
        animationStyle: asString(record["animationStyle"], ""),
        preferredSource: asString(record["preferredSource"], ""),
        notes: asString(record["notes"], ""),
      });
    } else {
      warnings.push("Skipped a malformed segment entry.");
    }
  });
  return segments;
}
