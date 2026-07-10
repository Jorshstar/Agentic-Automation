import type { AIKernel, AIGenerateRequest } from "../../ai/index.js";

/**
 * Voice casting — choose the narrator for THIS story.
 *
 * A niche profile carries a default voice, but a Lake Nyos mass-casualty
 * disaster and a bizarre coincidence should not be read by the same delivery.
 * One cheap Claude call picks the voice + delivery direction from the actual
 * script. NEVER throws: any failure returns the niche default unchanged.
 */

const VOICE_CASTING_PROMPT_ID = "voice-casting.user";

/** OpenAI TTS voices available to cast. */
const VOICES = [
  "alloy", "ash", "ballad", "coral", "echo", "fable", "onyx", "nova", "sage", "shimmer", "verse",
] as const;

export interface CastVoice {
  readonly voice: string;
  readonly voiceInstructions: string;
  readonly reason: string;
  /** True when casting failed and the niche default was kept. */
  readonly usedDefault: boolean;
  readonly tokenUsage: { readonly inputTokens: number; readonly outputTokens: number };
}

export interface VoiceCastingRequest {
  readonly title: string;
  readonly hook: string;
  readonly script: string;
  readonly tone: string;
  readonly audience: string;
  /** The niche's voice + delivery, used when casting fails or adds nothing. */
  readonly defaultVoice: string;
  readonly defaultInstructions: string;
}

export class ClaudeVoiceCastingProvider {
  readonly name = "claude-voice-casting-provider";

  constructor(private readonly kernel: AIKernel) {}

  async cast(request: VoiceCastingRequest): Promise<CastVoice> {
    const fallback: CastVoice = {
      voice: request.defaultVoice,
      voiceInstructions: request.defaultInstructions,
      reason: "niche default",
      usedDefault: true,
      tokenUsage: { inputTokens: 0, outputTokens: 0 },
    };

    const generateRequest: AIGenerateRequest = {
      promptId: VOICE_CASTING_PROMPT_ID,
      variables: {
        title: request.title,
        hook: request.hook || request.title,
        // The full script is the real signal; cap it so casting stays cheap.
        script: request.script.slice(0, 2000),
        tone: request.tone,
        audience: request.audience,
        voices: VOICES.join(", "),
        defaultVoice: request.defaultVoice,
      },
      expectedOutput: { format: "json", description: "a voice casting decision" },
      maxTokens: 400,
    };

    try {
      const generated = await this.kernel.generate<string>(generateRequest);
      const root = parseJsonObject(generated.output);
      const voice = str(root["voice"], "");
      if (!VOICES.includes(voice as (typeof VOICES)[number])) {
        return fallback;
      }
      return {
        voice,
        voiceInstructions: str(root["voiceInstructions"], request.defaultInstructions),
        reason: str(root["reason"], ""),
        usedDefault: false,
        tokenUsage: {
          inputTokens: generated.usage.inputTokens,
          outputTokens: generated.usage.outputTokens,
        },
      };
    } catch {
      return fallback;
    }
  }
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const cleaned = raw.replace(/```(?:json)?/giu, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(cleaned.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
