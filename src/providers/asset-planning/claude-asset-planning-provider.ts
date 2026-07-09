import type { AIKernel, AIGenerateRequest } from "../../ai/index.js";
import type { VisualAssetType, VisualDirectionPlan } from "../visual-direction/index.js";
import { VISUAL_ASSET_TYPES } from "../visual-direction/index.js";
import type { AssetPlanningProvider } from "./asset-planning-provider.js";
import type {
  AssetProviderName,
  AssetPlanContext,
  AssetPlanRequest,
  AssetPlan,
  AssetPlanSegment,
  AssetPlanMetadata,
} from "./types.js";
import { ASSET_PROVIDERS } from "./types.js";

/**
 * ClaudeAssetPlanningProvider — turns a VisualDirectionPlan into an AssetPlan
 * (per-segment sourcing recommendations).
 *
 * Its ONLY route to AI is `AIKernel.generate()`. It never imports the Anthropic
 * SDK, never writes a prompt string (it selects the managed prompt by id), never
 * names a model (the prompt's metadata does), and never makes an HTTP call. It
 * downloads and generates NOTHING — it only recommends providers and queries.
 *
 *   VisualDirectionPlan → AssetPlanningProvider (this) → AIKernel.generate() → Claude
 *                      → parsed AssetPlan
 *
 * NOTE ON PROMPTS: the current AI Kernel sends ONE prompt per call (rendered as
 * the user message), so this provider drives `asset-plan.user` — a self-contained
 * instruction. Its companion `asset-plan.system` is registered in Prompt
 * Management as the system-role prompt and will attach as a separate system
 * message once the kernel supports that, with no change here.
 */

/** The prompt this provider drives. The TEXT lives in the Prompt Management System. */
const ASSET_PLAN_PROMPT_ID = "asset-plan.user";

/** Sensible defaults for the context the visual direction plan doesn't carry. */
const DEFAULT_ASSET_PLAN_CONTEXT: AssetPlanContext = {
  platform: "YouTube Shorts",
  targetDurationSeconds: 60,
};

/** Fallback provider used when the model returns an unknown provider name. */
const FALLBACK_PROVIDER: AssetProviderName = "user-library";

export class ClaudeAssetPlanningProvider implements AssetPlanningProvider {
  readonly name = "claude-asset-planning-provider";

  private lastPlan: AssetPlan | undefined;

  constructor(
    private readonly kernel: AIKernel,
    private readonly context: AssetPlanContext = DEFAULT_ASSET_PLAN_CONTEXT,
  ) {}

  /** The most recent plan produced (handy for demos/telemetry). */
  get lastResult(): AssetPlan | undefined {
    return this.lastPlan;
  }

  async plan(request: AssetPlanRequest): Promise<AssetPlan> {
    const context: AssetPlanContext = { ...this.context, ...request.context };
    const segmentCount = request.visualDirection.segments.length;

    const generateRequest: AIGenerateRequest = {
      promptId: ASSET_PLAN_PROMPT_ID,
      variables: {
        segments: serializeSegments(request.visualDirection),
        platform: context.platform,
        targetDurationSeconds: context.targetDurationSeconds,
      },
      expectedOutput: { format: "json", description: "a per-segment asset-sourcing plan" },
      // A per-segment plan with search queries + detailed visual prompts is large;
      // give it ample room so the JSON is never truncated mid-object.
      maxTokens: 4096,
    };

    const generated = await this.kernel.generate<string>(generateRequest);

    const metadata: AssetPlanMetadata = {
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

    const plan = parseAssetPlan(generated.output, segmentCount, metadata);
    this.lastPlan = plan;
    return plan;
  }
}

/** Serialize the visual-direction segments into an ordered brief for the prompt. */
function serializeSegments(visualDirection: VisualDirectionPlan): string {
  return visualDirection.segments
    .map((segment) => {
      return (
        `${segment.segmentId}: assetType=${segment.assetType}; style=${segment.visualStyle}; ` +
        `color=${segment.colorMood}; camera=${segment.cameraMovement}; ` +
        `animation=${segment.animationStyle}; preferredSource=${segment.preferredSource || "—"}` +
        (segment.notes ? `\n   notes: ${segment.notes}` : "")
      );
    })
    .join("\n");
}

/**
 * Parse the model's JSON into a strongly-typed AssetPlan. Defensive: strips
 * fences, tolerates missing fields (warnings), coerces asset type + provider
 * names to their allowed sets, and flags a segment-count mismatch.
 */
function parseAssetPlan(
  raw: string,
  expectedSegmentCount: number,
  metadata: AssetPlanMetadata,
): AssetPlan {
  const warnings: string[] = [];
  const root = parseJsonObject(raw, warnings);

  const segments = asAssetSegmentArray(root["segments"], warnings);
  if (segments.length === 0) {
    warnings.push("No segments were parsed from the model output.");
  } else if (segments.length !== expectedSegmentCount) {
    warnings.push(
      `Segment count (${segments.length}) does not match the visual direction (${expectedSegmentCount}).`,
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

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asStringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asAssetType(value: unknown, warnings: string[]): VisualAssetType {
  if (typeof value === "string" && (VISUAL_ASSET_TYPES as readonly string[]).includes(value)) {
    return value as VisualAssetType;
  }
  warnings.push(`Unknown assetType "${String(value)}", defaulting to "mixed".`);
  return "mixed";
}

function asProvider(value: unknown, field: string, warnings: string[]): AssetProviderName {
  if (typeof value === "string" && (ASSET_PROVIDERS as readonly string[]).includes(value)) {
    return value as AssetProviderName;
  }
  warnings.push(`Unknown ${field} "${String(value)}", defaulting to "${FALLBACK_PROVIDER}".`);
  return FALLBACK_PROVIDER;
}

function asAssetSegmentArray(value: unknown, warnings: string[]): readonly AssetPlanSegment[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const segments: AssetPlanSegment[] = [];
  value.forEach((entry, index) => {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const record = entry as Record<string, unknown>;
      segments.push({
        segmentId: asString(record["segmentId"], `seg-${index + 1}`),
        assetType: asAssetType(record["assetType"], warnings),
        primaryProvider: asProvider(record["primaryProvider"], "primaryProvider", warnings),
        fallbackProvider: asProvider(record["fallbackProvider"], "fallbackProvider", warnings),
        searchQueries: asStringArray(record["searchQueries"]),
        visualPrompt: asString(record["visualPrompt"], ""),
        estimatedDuration: asNumber(record["estimatedDuration"], 0),
        licenseRequirements: asString(record["licenseRequirements"], ""),
        notes: asString(record["notes"], ""),
      });
    } else {
      warnings.push("Skipped a malformed segment entry.");
    }
  });
  return segments;
}
