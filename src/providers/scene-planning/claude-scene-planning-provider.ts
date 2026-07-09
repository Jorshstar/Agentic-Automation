import type { AIKernel, AIGenerateRequest } from "../../ai/index.js";
import type { NarrativeScript } from "../narrative/index.js";
import type { VisualDirectionPlan, VisualDirectionSegment } from "../visual-direction/index.js";
import type { AssetPlan, AssetPlanSegment } from "../asset-planning/index.js";
import type { ScenePlanningProvider } from "./scene-planning-provider.js";
import type {
  CaptionPosition,
  ScenePlanContext,
  ScenePlanRequest,
  ScenePlan,
  Scene,
  ScenePlanMetadata,
} from "./types.js";
import { CAPTION_POSITIONS } from "./types.js";

/**
 * ClaudeScenePlanningProvider — merges the narration timeline, visual direction,
 * and asset plan into a single ScenePlan (the execution contract).
 *
 * Its ONLY route to AI is `AIKernel.generate()`. It never imports the Anthropic
 * SDK, never writes a prompt string (it selects the managed prompt by id), never
 * names a model (the prompt's metadata does), and never makes an HTTP call. It
 * generates NOTHING — no assets, audio, or captions — it only composes the plan.
 *
 *   Narrative + VisualDirection + AssetPlan → ScenePlanningProvider (this)
 *     → AIKernel.generate() → Claude → parsed ScenePlan
 *
 * NOTE ON PROMPTS: the current AI Kernel sends ONE prompt per call (rendered as
 * the user message), so this provider drives `scene-plan.user` — a self-contained
 * instruction. Its companion `scene-plan.system` is registered in Prompt
 * Management as the system-role prompt and will attach as a separate system
 * message once the kernel supports that, with no change here.
 */

/** The prompt this provider drives. The TEXT lives in the Prompt Management System. */
const SCENE_PLAN_PROMPT_ID = "scene-plan.user";

/** Sensible defaults for the context the upstream plans don't carry. */
const DEFAULT_SCENE_PLAN_CONTEXT: ScenePlanContext = {
  platform: "YouTube Shorts",
};

/** The id given to the Nth segment (stable, order-preserving). */
function segmentId(index: number): string {
  return `seg-${index + 1}`;
}

export class ClaudeScenePlanningProvider implements ScenePlanningProvider {
  readonly name = "claude-scene-planning-provider";

  private lastPlan: ScenePlan | undefined;

  constructor(
    private readonly kernel: AIKernel,
    private readonly context: ScenePlanContext = DEFAULT_SCENE_PLAN_CONTEXT,
  ) {}

  /** The most recent plan produced (handy for demos/telemetry). */
  get lastResult(): ScenePlan | undefined {
    return this.lastPlan;
  }

  async plan(request: ScenePlanRequest): Promise<ScenePlan> {
    const context: ScenePlanContext = { ...this.context, ...request.context };
    const segmentCount = request.narrative.segments.length;

    const generateRequest: AIGenerateRequest = {
      promptId: SCENE_PLAN_PROMPT_ID,
      variables: {
        segments: mergeSegments(request.narrative, request.visualDirection, request.assetPlan),
        platform: context.platform,
      },
      expectedOutput: { format: "json", description: "an ordered, merged scene plan" },
      // A merged plan with many fields per scene is large; give it ample room.
      maxTokens: 4096,
    };

    const generated = await this.kernel.generate<string>(generateRequest);

    const metadata: ScenePlanMetadata = {
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

    const plan = parseScenePlan(generated.output, segmentCount, metadata);
    this.lastPlan = plan;
    return plan;
  }
}

/**
 * Align the three upstream plans by segment id and flatten them into one brief.
 * Narration segments are index-based (seg-1, seg-2, ...); visual/asset segments
 * carry those ids, so we join on them.
 */
function mergeSegments(
  narrative: NarrativeScript,
  visualDirection: VisualDirectionPlan,
  assetPlan: AssetPlan,
): string {
  const visualById = new Map<string, VisualDirectionSegment>(
    visualDirection.segments.map((segment) => [segment.segmentId, segment]),
  );
  const assetById = new Map<string, AssetPlanSegment>(
    assetPlan.segments.map((segment) => [segment.segmentId, segment]),
  );

  return narrative.segments
    .map((narrationSegment, index) => {
      const id = segmentId(index);
      const visual = visualById.get(id);
      const asset = assetById.get(id);

      const visualLine = visual
        ? `${visual.assetType}; camera=${visual.cameraMovement}; style=${visual.visualStyle}; ` +
          `color=${visual.colorMood}; transition=${visual.transition}; animation=${visual.animationStyle}`
        : "—";

      const assetSource =
        asset && asset.searchQueries.length > 0
          ? asset.searchQueries.slice(0, 2).join(" / ")
          : asset?.visualPrompt.slice(0, 80) ?? "—";
      const assetLine = asset
        ? `type=${asset.assetType}; primary=${asset.primaryProvider}; fallback=${asset.fallbackProvider}; source=${assetSource}`
        : "—";

      return (
        `${id}: [${narrationSegment.startSecond}s-${narrationSegment.endSecond}s] ` +
        `emotion=${narrationSegment.emotion}\n` +
        `   narration: "${narrationSegment.text}"\n` +
        `   visual hint: ${narrationSegment.visualHint || "—"}\n` +
        `   visual direction: ${visualLine}\n` +
        `   asset: ${assetLine}`
      );
    })
    .join("\n\n");
}

/**
 * Parse the model's JSON into a strongly-typed ScenePlan. Defensive: strips
 * fences, tolerates missing fields (warnings), coerces the caption position to
 * the allowed set, and flags a scene-count mismatch vs the narration.
 */
function parseScenePlan(
  raw: string,
  expectedSceneCount: number,
  metadata: ScenePlanMetadata,
): ScenePlan {
  const warnings: string[] = [];
  const root = parseJsonObject(raw, warnings);

  const scenes = asSceneArray(root["scenes"], warnings);
  if (scenes.length === 0) {
    warnings.push("No scenes were parsed from the model output.");
  } else if (scenes.length !== expectedSceneCount) {
    warnings.push(
      `Scene count (${scenes.length}) does not match the narration (${expectedSceneCount}).`,
    );
  }

  return { scenes, warnings, metadata };
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

function asCaptionPosition(value: unknown, warnings: string[]): CaptionPosition {
  if (typeof value === "string" && (CAPTION_POSITIONS as readonly string[]).includes(value)) {
    return value as CaptionPosition;
  }
  warnings.push(`Unknown captionPosition "${String(value)}", defaulting to "bottom".`);
  return "bottom";
}

function asSceneArray(value: unknown, warnings: string[]): readonly Scene[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const scenes: Scene[] = [];
  value.forEach((entry, index) => {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const record = entry as Record<string, unknown>;
      const id = asString(record["segmentId"], segmentId(index));
      scenes.push({
        sceneId: asString(record["sceneId"], `scene-${index + 1}`),
        segmentId: id,
        startSecond: asNumber(record["startSecond"], 0),
        endSecond: asNumber(record["endSecond"], 0),
        primaryAsset: asString(record["primaryAsset"], ""),
        fallbackAsset: asString(record["fallbackAsset"], ""),
        cameraMovement: asString(record["cameraMovement"], ""),
        transitionIn: asString(record["transitionIn"], ""),
        transitionOut: asString(record["transitionOut"], ""),
        overlayText: asString(record["overlayText"], ""),
        captionPosition: asCaptionPosition(record["captionPosition"], warnings),
        voiceSegmentId: asString(record["voiceSegmentId"], id),
        musicMood: asString(record["musicMood"], ""),
        notes: asString(record["notes"], ""),
      });
    } else {
      warnings.push("Skipped a malformed scene entry.");
    }
  });
  return scenes;
}
