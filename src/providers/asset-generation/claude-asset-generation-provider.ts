import type { AIKernel, AIGenerateRequest } from "../../ai/index.js";
import type { VisualAssetType } from "../visual-direction/index.js";
import { VISUAL_ASSET_TYPES } from "../visual-direction/index.js";
import type { AssetProviderName, AssetPlan } from "../asset-planning/index.js";
import { ASSET_PROVIDERS } from "../asset-planning/index.js";
import type { AssetGenerationProvider } from "./asset-generation-provider.js";
import type {
  AssetGenerationMethod,
  AssetGenerationStatus,
  AssetGenerationWarning,
  AssetGenerationWarningCode,
  AssetProviderResult,
  GeneratedAsset,
  GeneratedAssets,
  GeneratedAssetContext,
  GeneratedAssetRequest,
  AssetGenerationRunMetadata,
} from "./types.js";
import { ASSET_GENERATION_METHODS, ASSET_GENERATION_STATUSES } from "./types.js";

/**
 * ClaudeAssetGenerationProvider — produces the asset-production manifest from an
 * AssetPlan.
 *
 * Its ONLY route to AI is `AIKernel.generate()`. It does NOT import the Anthropic
 * SDK, does NOT import PromptManager, makes NO HTTP calls, downloads NO files, and
 * renders NOTHING. It produces a structured description of the assets that WOULD
 * be generated/downloaded later — real provider adapters plug in behind the same
 * interface without changing callers.
 *
 *   AssetPlan → AssetGenerationProvider (this) → AIKernel.generate() → Claude
 *            → parsed AssetProviderResult[] → enriched GeneratedAssets
 *
 * NOTE ON PROMPTS: the current AI Kernel sends ONE prompt per call (rendered as
 * the user message), so this provider drives `asset-generation.user` — a
 * self-contained instruction. Its companion `asset-generation.system` is
 * registered in Prompt Management as the system-role prompt and will attach as a
 * separate system message once the kernel supports that, with no change here.
 */

/** The prompt this provider drives. The TEXT lives in the Prompt Management System. */
const ASSET_GENERATION_PROMPT_ID = "asset-generation.user";
/** Role + rules, sent as the system instruction. */
const ASSET_GENERATION_SYSTEM_PROMPT_ID = "asset-generation.system";

/** Sensible defaults for the context the AssetPlan doesn't carry (9:16 vertical). */
const DEFAULT_ASSET_GENERATION_CONTEXT: GeneratedAssetContext = {
  platform: "YouTube Shorts",
  width: 1080,
  height: 1920,
  assetRootDir: "assets/generated",
};

/** Provider used when the model returns an unknown provider name. */
const FALLBACK_PROVIDER: AssetProviderName = "user-library";

export class ClaudeAssetGenerationProvider implements AssetGenerationProvider {
  readonly name = "claude-asset-generation-provider";

  private lastGenerated: GeneratedAssets | undefined;

  constructor(
    private readonly kernel: AIKernel,
    private readonly context: GeneratedAssetContext = DEFAULT_ASSET_GENERATION_CONTEXT,
  ) {}

  /** The most recent result produced (handy for demos/telemetry). */
  get lastResult(): GeneratedAssets | undefined {
    return this.lastGenerated;
  }

  async generate(request: GeneratedAssetRequest): Promise<GeneratedAssets> {
    const context: GeneratedAssetContext = { ...this.context, ...request.context };
    const expectedCount = request.assetPlan.segments.length;

    const generateRequest: AIGenerateRequest = {
      promptId: ASSET_GENERATION_PROMPT_ID,
      systemPromptId: ASSET_GENERATION_SYSTEM_PROMPT_ID,
      variables: {
        segments: serializeAssetPlan(request.assetPlan),
        platform: context.platform,
        width: context.width,
        height: context.height,
      },
      expectedOutput: { format: "json", description: "an asset-production manifest" },
      // A manifest with many fields per asset is large; give it ample room.
      maxTokens: 4096,
    };

    const generated = await this.kernel.generate<string>(generateRequest);

    const metadata: AssetGenerationRunMetadata = {
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

    const warnings: AssetGenerationWarning[] = [];
    const results = parseProviderResults(generated.output, warnings);

    if (results.length === 0) {
      warnings.push(warn("parse-error", "No asset results were parsed from the model output."));
    } else if (results.length !== expectedCount) {
      warnings.push(
        warn(
          "count-mismatch",
          `Asset count (${results.length}) does not match the plan (${expectedCount}).`,
        ),
      );
    }

    const assets = results.map((result, index) => toGeneratedAsset(result, index, context));

    const output: GeneratedAssets = { assets, warnings, metadata };
    this.lastGenerated = output;
    return output;
  }
}

/** Build a structured warning. */
function warn(
  code: AssetGenerationWarningCode,
  message: string,
  segmentId?: string,
): AssetGenerationWarning {
  return segmentId === undefined ? { code, message } : { code, message, segmentId };
}

/** Serialize the asset-plan segments into an ordered brief for the prompt. */
function serializeAssetPlan(assetPlan: AssetPlan): string {
  return assetPlan.segments
    .map((segment) => {
      const queries = segment.searchQueries.length > 0 ? segment.searchQueries.join(" / ") : "—";
      return (
        `${segment.segmentId}: assetType=${segment.assetType}; ` +
        `primary=${segment.primaryProvider}; fallback=${segment.fallbackProvider}; ` +
        `duration≈${segment.estimatedDuration}s; license=${segment.licenseRequirements}\n` +
        `   queries: ${queries}\n` +
        `   visualPrompt: ${segment.visualPrompt || "—"}`
      );
    })
    .join("\n");
}

/**
 * Enrich a normalized provider result into a pipeline GeneratedAsset: assign a
 * stable asset/scene id, derive the planned local path, and carry per-asset
 * metadata. `checksum` stays empty because no file is produced at this stage.
 */
function toGeneratedAsset(
  result: AssetProviderResult,
  index: number,
  context: GeneratedAssetContext,
): GeneratedAsset {
  const extension = mimeToExtension(result.mimeType);
  return {
    assetId: `asset-${index + 1}`,
    sceneId: `scene-${index + 1}`,
    segmentId: result.segmentId,
    assetType: result.assetType,
    provider: result.provider,
    sourceUrl: result.sourceUrl,
    localPath: `${context.assetRootDir}/${result.segmentId}.${extension}`,
    mimeType: result.mimeType,
    width: result.width > 0 ? result.width : context.width,
    height: result.height > 0 ? result.height : context.height,
    durationSeconds: result.durationSeconds,
    checksum: "", // populated only once the file is actually produced/downloaded
    license: result.license,
    generationMethod: result.generationMethod,
    metadata: {
      status: result.status,
      primaryProvider: result.provider,
      fallbackProvider: result.fallbackProvider,
      generationMethod: result.generationMethod,
      estimatedCostUsd: result.estimatedCostUsd,
      notes: result.notes,
    },
  };
}

/** Map a mime type to a file extension for the planned local path. */
function mimeToExtension(mimeType: string): string {
  switch (mimeType) {
    case "video/mp4":
      return "mp4";
    case "video/webm":
      return "webm";
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    default:
      return "bin";
  }
}

/* ----------------------------- defensive parsing ---------------------------- */

function parseProviderResults(
  raw: string,
  warnings: AssetGenerationWarning[],
): readonly AssetProviderResult[] {
  const root = parseJsonObject(raw, warnings);
  const value = root["results"];
  if (!Array.isArray(value)) {
    return [];
  }
  const results: AssetProviderResult[] = [];
  value.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      warnings.push(warn("malformed-entry", `Skipped a malformed result entry at index ${index}.`));
      return;
    }
    const record = entry as Record<string, unknown>;
    const segmentId = asString(record["segmentId"], `seg-${index + 1}`);
    results.push({
      segmentId,
      assetType: asAssetType(record["assetType"], warnings, segmentId),
      provider: asProvider(record["provider"], "provider", warnings, segmentId),
      fallbackProvider: asProvider(record["fallbackProvider"], "fallbackProvider", warnings, segmentId),
      generationMethod: asMethod(record["generationMethod"], warnings, segmentId),
      sourceUrl: asString(record["sourceUrl"], ""),
      mimeType: asString(record["mimeType"], "application/octet-stream"),
      width: asNumber(record["width"], 0),
      height: asNumber(record["height"], 0),
      durationSeconds: asNumber(record["durationSeconds"], 0),
      license: asString(record["license"], ""),
      status: asStatus(record["status"], warnings, segmentId),
      estimatedCostUsd: asNumber(record["estimatedCostUsd"], 0),
      notes: asString(record["notes"], ""),
    });
  });
  return results;
}

/** Strip markdown fences / prose and JSON.parse the first object found. */
function parseJsonObject(raw: string, warnings: AssetGenerationWarning[]): Record<string, unknown> {
  const withoutFences = raw.replace(/```(?:json)?/giu, "").trim();
  const start = withoutFences.indexOf("{");
  const end = withoutFences.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    warnings.push(warn("parse-error", "Model output did not contain a JSON object."));
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(withoutFences.slice(start, end + 1));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    warnings.push(warn("parse-error", "Model output JSON was not an object."));
    return {};
  } catch {
    warnings.push(warn("parse-error", "Model output was not valid JSON."));
    return {};
  }
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asAssetType(
  value: unknown,
  warnings: AssetGenerationWarning[],
  segmentId: string,
): VisualAssetType {
  if (typeof value === "string" && (VISUAL_ASSET_TYPES as readonly string[]).includes(value)) {
    return value as VisualAssetType;
  }
  warnings.push(warn("unknown-asset-type", `Unknown assetType "${String(value)}" → "mixed".`, segmentId));
  return "mixed";
}

function asProvider(
  value: unknown,
  field: string,
  warnings: AssetGenerationWarning[],
  segmentId: string,
): AssetProviderName {
  if (typeof value === "string" && (ASSET_PROVIDERS as readonly string[]).includes(value)) {
    return value as AssetProviderName;
  }
  warnings.push(
    warn("unknown-provider", `Unknown ${field} "${String(value)}" → "${FALLBACK_PROVIDER}".`, segmentId),
  );
  return FALLBACK_PROVIDER;
}

function asMethod(
  value: unknown,
  warnings: AssetGenerationWarning[],
  segmentId: string,
): AssetGenerationMethod {
  if (typeof value === "string" && (ASSET_GENERATION_METHODS as readonly string[]).includes(value)) {
    return value as AssetGenerationMethod;
  }
  warnings.push(warn("unknown-method", `Unknown generationMethod "${String(value)}" → "stock-download".`, segmentId));
  return "stock-download";
}

function asStatus(
  value: unknown,
  warnings: AssetGenerationWarning[],
  segmentId: string,
): AssetGenerationStatus {
  if (typeof value === "string" && (ASSET_GENERATION_STATUSES as readonly string[]).includes(value)) {
    return value as AssetGenerationStatus;
  }
  warnings.push(warn("unknown-status", `Unknown status "${String(value)}" → "planned".`, segmentId));
  return "planned";
}
