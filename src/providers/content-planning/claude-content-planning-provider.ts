import type { AIKernel, AIGenerateRequest } from "../../ai/index.js";
import type { ContentPlanningProvider } from "./content-planning-provider.js";
import type {
  ContentPlan,
  ContentPlanContext,
  ContentPlanRequest,
  ContentPlanSection,
  ContentPlanMetadata,
} from "./types.js";

/**
 * ClaudeContentPlanningProvider — turns research into a structured ContentPlan.
 *
 * Its ONLY route to AI is `AIKernel.generate()`. It never imports the Anthropic
 * SDK, never writes a prompt string (it selects the managed prompt by id), never
 * names a model (the prompt's metadata does), and never makes an HTTP call.
 *
 *   research → ContentPlanningProvider (this) → AIKernel.generate() → Claude
 *            → parsed ContentPlan
 *
 * NOTE ON PROMPTS: the current AI Kernel sends ONE prompt per call (rendered as
 * the user message), so this provider drives `content-plan.user` — a
 * self-contained instruction. Its companion `content-plan.system` is registered
 * in Prompt Management as the system-role prompt and will be attached as a
 * separate system message once the kernel supports that, with no change here.
 */

/** The prompt this provider drives. The TEXT lives in the Prompt Management System. */
const CONTENT_PLAN_PROMPT_ID = "content-plan.user";
/** Role + rules, sent as the system instruction. */
const CONTENT_PLAN_SYSTEM_PROMPT_ID = "content-plan.system";

/** Sensible defaults for the production context the request doesn't carry. */
const DEFAULT_CONTENT_PLAN_CONTEXT: ContentPlanContext = {
  audience: "General Audience",
  tone: "Educational",
  language: "English",
  platform: "YouTube Shorts",
  targetDurationSeconds: 60,
};

export class ClaudeContentPlanningProvider implements ContentPlanningProvider {
  readonly name = "claude-content-planning-provider";

  private lastPlan: ContentPlan | undefined;

  constructor(
    private readonly kernel: AIKernel,
    private readonly context: ContentPlanContext = DEFAULT_CONTENT_PLAN_CONTEXT,
  ) {}

  /** The most recent plan produced (handy for demos/telemetry). */
  get lastResult(): ContentPlan | undefined {
    return this.lastPlan;
  }

  async plan(request: ContentPlanRequest): Promise<ContentPlan> {
    const context: ContentPlanContext = { ...this.context, ...request.context };
    const keyPoints = request.research.keyPoints.map((point) => `- ${point}`).join("\n");

    const generateRequest: AIGenerateRequest = {
      promptId: CONTENT_PLAN_PROMPT_ID,
      systemPromptId: CONTENT_PLAN_SYSTEM_PROMPT_ID,
      variables: {
        topic: request.topic,
        researchSummary: request.research.summary,
        keyPoints,
        audience: context.audience,
        tone: context.tone,
        platform: context.platform,
        language: context.language,
        targetDurationSeconds: context.targetDurationSeconds,
      },
      expectedOutput: { format: "json", description: "a structured content plan" },
      // The scary/historical briefing is a large input and the plan (with per-
      // section narration hints) can run long; 1500 truncated the JSON mid-object.
      maxTokens: 2800,
    };

    const generated = await this.kernel.generate<string>(generateRequest);

    const metadata: ContentPlanMetadata = {
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

    const plan = parseContentPlan(generated.output, context, metadata);
    this.lastPlan = plan;
    return plan;
  }
}

/**
 * Parse the model's JSON into a strongly-typed ContentPlan. Deliberately
 * defensive: strips any markdown fences, tolerates missing fields (recording a
 * warning instead of throwing), and coerces each field to its expected type.
 */
function parseContentPlan(
  raw: string,
  context: ContentPlanContext,
  metadata: ContentPlanMetadata,
): ContentPlan {
  const warnings: string[] = [];
  const root = parseJsonObject(raw, warnings);

  const sections = asSectionArray(root["sections"], warnings);
  if (sections.length === 0) {
    warnings.push("No sections were parsed from the model output.");
  }

  return {
    hook: requireString(root["hook"], "hook", warnings),
    coreMessage: requireString(root["coreMessage"], "coreMessage", warnings),
    targetAudience: asString(root["targetAudience"], context.audience),
    tone: asString(root["tone"], context.tone),
    estimatedDurationSeconds: asNumber(
      root["estimatedDurationSeconds"],
      context.targetDurationSeconds,
    ),
    sections,
    callToAction: requireString(root["callToAction"], "callToAction", warnings),
    visualStyle: asString(root["visualStyle"], ""),
    riskNotes: asStringArray(root["riskNotes"]),
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

function asStringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asSectionArray(value: unknown, warnings: string[]): readonly ContentPlanSection[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const sections: ContentPlanSection[] = [];
  for (const entry of value) {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const record = entry as Record<string, unknown>;
      sections.push({
        title: asString(record["title"], ""),
        purpose: asString(record["purpose"], ""),
        durationSeconds: asNumber(record["durationSeconds"], 0),
        keyPoints: asStringArray(record["keyPoints"]),
      });
    } else {
      warnings.push("Skipped a malformed section entry.");
    }
  }
  return sections;
}
