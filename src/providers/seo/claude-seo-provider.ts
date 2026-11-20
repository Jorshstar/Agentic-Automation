import type { AIKernel, AIGenerateRequest } from "../../ai/index.js";
import { textProviderOptions } from "../../ai/text-provider.js";
import type { SeoProvider } from "./seo-provider.js";
import type {
  SeoRequest,
  SeoPack,
  YouTubeSeo,
  TikTokSeo,
  SeoWarning,
  SeoMetadata,
} from "./types.js";

/**
 * ClaudeSeoProvider — writes the YouTube/TikTok upload kit for a finished video.
 *
 * Its ONLY route to AI is `AIKernel.generate()` (no Anthropic SDK, no prompt
 * text, no model names, no HTTP). Unusually for this pipeline it NEVER throws:
 * SEO is garnish on a finished video, so any failure (API error, bad JSON)
 * degrades to a usable fallback pack built from the topic/hook/keywords, with a
 * structured warning — the video is never blocked.
 */

/** The prompt this provider drives. The TEXT lives in the Prompt Management System. */
const SEO_PROMPT_ID = "seo.user";
/** Role + rules, sent as the system instruction. */
const SEO_SYSTEM_PROMPT_ID = "seo.system";

export class ClaudeSeoProvider implements SeoProvider {
  readonly name = "claude-seo-provider";

  constructor(private readonly kernel: AIKernel) {}

  async generate(request: SeoRequest): Promise<SeoPack> {
    const warnings: SeoWarning[] = [];

    const generateRequest: AIGenerateRequest = {
      promptId: SEO_PROMPT_ID,
      systemPromptId: SEO_SYSTEM_PROMPT_ID,
      variables: {
        topic: request.topic,
        hook: request.hook,
        script: request.script,
        niche: request.niche,
        tone: request.tone,
        audience: request.audience,
        keywords: request.keywords.join(", "),
        durationSeconds: Math.round(request.durationSeconds),
        platform: request.platform ?? "YouTube Shorts and TikTok",
      },
      expectedOutput: { format: "json", description: "a YouTube + TikTok upload kit" },
      // Generous because reasoning models spend part of the budget thinking
      // before they write, and a short budget returns an empty completion with
      // a 200 status.
      maxTokens: 2000,
      // SEO is text work, so it follows whichever text endpoint is configured.
      ...textProviderOptions("SEO_MODEL"),
    };

    try {
      const generated = await this.kernel.generate<string>(generateRequest);
      const metadata: SeoMetadata = {
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
      return parseSeoPack(generated.output, request, metadata, warnings);
    } catch (error) {
      warnings.push({
        code: "generation-failed",
        message: error instanceof Error ? error.message : String(error),
      });
      return fallbackPack(request, warnings);
    }
  }
}

/* ------------------------------ parsing helpers ----------------------------- */

function parseSeoPack(
  raw: string,
  request: SeoRequest,
  metadata: SeoMetadata,
  warnings: SeoWarning[],
): SeoPack {
  const root = parseJsonObject(raw, warnings);
  const fallback = fallbackFields(request);

  const yt = asRecord(root["youtube"]);
  const tk = asRecord(root["tiktok"]);

  const youtube: YouTubeSeo = {
    title: clamp(requireString(yt["title"], "youtube.title", fallback.title, warnings), 100),
    description: requireString(yt["description"], "youtube.description", fallback.description, warnings),
    tags: asStringArray(yt["tags"]).map((tag) => tag.toLowerCase()),
    hashtags: normalizeHashtags(asStringArray(yt["hashtags"]), ["#shorts"]),
  };
  const tiktok: TikTokSeo = {
    caption: clamp(requireString(tk["caption"], "tiktok.caption", request.hook, warnings), 150),
    hashtags: normalizeHashtags(asStringArray(tk["hashtags"]), ["#fyp"]),
  };
  const thumbnailText = clamp(
    requireString(root["thumbnailText"], "thumbnailText", fallbackThumbText(request.topic), warnings),
    24,
  ).toUpperCase();

  return { youtube, tiktok, thumbnailText, warnings, metadata };
}

/** Fallback cover text: the topic's first few words, ALL CAPS, clamped. */
function fallbackThumbText(topic: string): string {
  return topic.split(/\s+/u).slice(0, 4).join(" ").toUpperCase();
}

/** A usable pack built without AI, from what the pipeline already knows. */
function fallbackPack(request: SeoRequest, warnings: readonly SeoWarning[]): SeoPack {
  const f = fallbackFields(request);
  return {
    youtube: {
      title: f.title,
      description: f.description,
      tags: request.keywords.map((keyword) => keyword.toLowerCase()),
      hashtags: normalizeHashtags([nicheHashtag(request.niche)], ["#shorts"]),
    },
    tiktok: {
      caption: clamp(request.hook || request.topic, 150),
      hashtags: normalizeHashtags([nicheHashtag(request.niche), "#viral"], ["#fyp"]),
    },
    thumbnailText: clamp(fallbackThumbText(request.topic), 24),
    warnings,
    metadata: {
      promptId: SEO_PROMPT_ID,
      promptVersion: "fallback",
      provider: "none",
      model: "none",
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      latencyMs: 0,
    },
  };
}

function fallbackFields(request: SeoRequest): { title: string; description: string } {
  return {
    title: clamp(request.topic, 100),
    description: `${request.hook} Watch to the end — and subscribe for more ${request.niche.toLowerCase()}.`,
  };
}

/** "Scary Stories" → "#scarystories". */
function nicheHashtag(niche: string): string {
  return `#${niche.toLowerCase().replace(/[^a-z0-9]/gu, "")}`;
}

/** Ensure '#'-prefixed, no spaces/punctuation; dedupe; force `required` present. */
function normalizeHashtags(tags: readonly string[], required: readonly string[]): readonly string[] {
  const cleaned = tags
    .map((tag) => `#${tag.replace(/#/gu, "").replace(/[^\p{L}\p{N}]/gu, "")}`)
    .filter((tag) => tag.length > 1);
  const all = [...cleaned];
  for (const tag of required) {
    if (!all.some((existing) => existing.toLowerCase() === tag.toLowerCase())) {
      all.push(tag);
    }
  }
  return [...new Set(all)];
}

function clamp(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Strip markdown fences / prose and JSON.parse the first object found. */
function parseJsonObject(raw: string, warnings: SeoWarning[]): Record<string, unknown> {
  const withoutFences = raw.replace(/```(?:json)?/giu, "").trim();
  const start = withoutFences.indexOf("{");
  const end = withoutFences.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    warnings.push({ code: "parse-error", message: "Model output did not contain a JSON object." });
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(withoutFences.slice(start, end + 1));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    warnings.push({ code: "parse-error", message: "Model output JSON was not an object." });
    return {};
  } catch {
    warnings.push({ code: "parse-error", message: "Model output was not valid JSON." });
    return {};
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asStringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function requireString(
  value: unknown,
  field: string,
  fallback: string,
  warnings: SeoWarning[],
): string {
  if (typeof value === "string" && value.trim() !== "") {
    return value.trim();
  }
  warnings.push({ code: "missing-field", message: `Missing or empty field: "${field}".` });
  return fallback;
}
