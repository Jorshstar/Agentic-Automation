import type { AIKernel, AIGenerateRequest } from "../../ai/index.js";
import type { NicheProfile, Pacing } from "../../config/niche-profiles.js";
import type { MusicMood } from "../music-generation/index.js";
import { MUSIC_MOODS } from "../music-generation/index.js";
import type { IdentityDesignProvider } from "./identity-design-provider.js";
import type {
  IdentityDesignRequest,
  DesignedIdentity,
  IdentityDesignWarning,
  IdentityDesignMetadata,
} from "./types.js";

/**
 * ClaudeIdentityDesignProvider — designs a one-off creative identity from a brief.
 *
 * Its ONLY route to AI is `AIKernel.generate()`. Every enum-ish field (voice,
 * music preset, font, pacing, position) is coerced to a safe allowed set, so a
 * hallucinated value degrades to a sensible default with a warning instead of
 * breaking the pipeline. It NEVER throws — a total failure returns a neutral
 * identity built from the brief text itself.
 */

const IDENTITY_PROMPT_ID = "identity.user";
/** Role + rules, sent as the system instruction. */
const IDENTITY_SYSTEM_PROMPT_ID = "identity.system";

/** OpenAI TTS voices the designer may pick from. */
const VOICES = [
  "alloy", "ash", "ballad", "coral", "echo", "fable", "onyx", "nova", "sage", "shimmer", "verse",
] as const;

/** System fonts safe for libass on this pipeline. */
const FONTS = ["Arial", "Arial Black", "Verdana", "Georgia", "Trebuchet MS", "Impact", "Segoe UI"] as const;

const PACINGS: readonly Pacing[] = ["slow", "medium", "fast"];

export class ClaudeIdentityDesignProvider implements IdentityDesignProvider {
  readonly name = "claude-identity-design-provider";

  constructor(private readonly kernel: AIKernel) {}

  async design(request: IdentityDesignRequest): Promise<DesignedIdentity> {
    const warnings: IdentityDesignWarning[] = [];

    const generateRequest: AIGenerateRequest = {
      promptId: IDENTITY_PROMPT_ID,
      systemPromptId: IDENTITY_SYSTEM_PROMPT_ID,
      variables: {
        instructions: request.instructions,
        voices: VOICES.join(", "),
        musicPresets: MUSIC_MOODS.join(", "),
        fonts: FONTS.join(", "),
      },
      expectedOutput: { format: "json", description: "a complete creative identity" },
      maxTokens: 900,
    };

    try {
      const generated = await this.kernel.generate<string>(generateRequest);
      const metadata: IdentityDesignMetadata = {
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
      return { profile: parseIdentity(generated.output, request, warnings), warnings, metadata };
    } catch (error) {
      warnings.push({
        code: "generation-failed",
        message: error instanceof Error ? error.message : String(error),
      });
      return {
        profile: fallbackIdentity(request),
        warnings,
        metadata: {
          promptId: IDENTITY_PROMPT_ID,
          promptVersion: "fallback",
          provider: "none",
          model: "none",
          tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          latencyMs: 0,
        },
      };
    }
  }
}

/* ------------------------------- parsing ------------------------------- */

function parseIdentity(
  raw: string,
  request: IdentityDesignRequest,
  warnings: IdentityDesignWarning[],
): NicheProfile {
  const root = parseJsonObject(raw, warnings);
  const fallback = fallbackIdentity(request);

  return {
    niche: "custom",
    label: str(root["label"], fallback.label),
    audience: str(root["audience"], fallback.audience),
    tone: str(root["tone"], fallback.tone),
    language: str(root["language"], "English"),
    pacing: oneOf(root["pacing"], PACINGS, "medium", "pacing", warnings),
    voice: oneOf(root["voice"], VOICES, "verse", "voice", warnings),
    voiceInstructions: str(root["voiceInstructions"], fallback.voiceInstructions),
    visualStyle: str(root["visualStyle"], fallback.visualStyle),
    colorMood: str(root["colorMood"], fallback.colorMood),
    musicMood: str(root["musicMood"], fallback.musicMood),
    musicPreset: oneOf(root["musicPreset"], MUSIC_MOODS, "neutral", "musicPreset", warnings) as MusicMood,
    captionAccent: hexColor(root["captionAccent"], "#FFFFFF", warnings),
    captionFont: oneOf(root["captionFont"], FONTS, "Arial", "captionFont", warnings),
    // Subtitles are ALWAYS bottom (user rule) — the designer's choice is ignored.
    captionPosition: "bottom",
    captionKaraoke: typeof root["captionKaraoke"] === "boolean" ? root["captionKaraoke"] : false,
    topicThemes: strArray(root["themes"], [request.instructions]),
  };
}

/** A neutral but usable identity built purely from the brief text. */
function fallbackIdentity(request: IdentityDesignRequest): NicheProfile {
  return {
    niche: "custom",
    label: "Custom Brief",
    audience: "a general short-form video audience",
    tone: "engaging, clear",
    language: "English",
    pacing: "medium",
    voice: "verse",
    voiceInstructions: "Natural, engaging delivery with clear pacing.",
    visualStyle: "clean, cinematic, high detail",
    colorMood: "balanced natural tones with strong contrast",
    musicMood: "subtle ambient bed",
    musicPreset: "neutral",
    captionAccent: "#FFFFFF",
    captionFont: "Arial",
    captionPosition: "bottom",
    captionKaraoke: false,
    topicThemes: [request.instructions],
  };
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
}

function strArray(value: unknown, fallback: readonly string[]): readonly string[] {
  const items = Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  return items.length > 0 ? items : fallback;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
  field: string,
  warnings: IdentityDesignWarning[],
): T {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  warnings.push({ code: "missing-field", message: `"${field}" was "${String(value)}" → "${fallback}".` });
  return fallback;
}

function hexColor(value: unknown, fallback: string, warnings: IdentityDesignWarning[]): string {
  if (typeof value === "string" && /^#[0-9a-fA-F]{6}$/u.test(value.trim())) {
    return value.trim().toUpperCase();
  }
  warnings.push({ code: "missing-field", message: `captionAccent invalid → "${fallback}".` });
  return fallback;
}

function parseJsonObject(raw: string, warnings: IdentityDesignWarning[]): Record<string, unknown> {
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
