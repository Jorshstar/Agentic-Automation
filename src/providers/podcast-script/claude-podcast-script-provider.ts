import type { AIKernel, AIGenerateRequest } from "../../ai/index.js";
import type {
  PodcastScriptRequest,
  PodcastScript,
  PodcastCastMember,
  PodcastTurn,
  PodcastScriptWarning,
  PodcastScriptMetadata,
} from "./types.js";

/**
 * ClaudePodcastScriptProvider — writes the two-host conversation via the AI
 * Kernel only. Defensive like every parser here: the cast is coerced to exactly
 * two members with DIFFERENT valid voices, and every turn's speaker is coerced
 * onto the cast (alternating when unknown) — a malformed script degrades with
 * warnings, never crashes the run.
 */

const PODCAST_PROMPT_ID = "podcast-script.user";
const VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "onyx", "nova", "sage", "shimmer", "verse"];

export interface PodcastScriptProvider {
  readonly name: string;
  write(request: PodcastScriptRequest): Promise<PodcastScript>;
}

export class ClaudePodcastScriptProvider implements PodcastScriptProvider {
  readonly name = "claude-podcast-script-provider";

  constructor(private readonly kernel: AIKernel) {}

  async write(request: PodcastScriptRequest): Promise<PodcastScript> {
    const warnings: PodcastScriptWarning[] = [];

    const generateRequest: AIGenerateRequest = {
      promptId: PODCAST_PROMPT_ID,
      variables: {
        topic: request.topic,
        researchSummary: request.research.summary,
        keyPoints: request.research.keyPoints.map((point) => `- ${point}`).join("\n"),
        tone: request.tone,
        audience: request.audience,
        language: request.language,
        minWords: request.minWords,
        maxWords: request.maxWords,
        voices: VOICES.join(", "),
      },
      expectedOutput: { format: "json", description: "a two-host podcast script" },
      maxTokens: 2600,
    };

    const generated = await this.kernel.generate<string>(generateRequest);
    const metadata: PodcastScriptMetadata = {
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

    const root = parseJsonObject(generated.output, warnings);
    const cast = coerceCast(root["cast"], warnings);
    const turns = coerceTurns(root["turns"], cast, warnings);
    const totalWords = turns.reduce((sum, turn) => sum + countWords(turn.text), 0);

    return { cast, turns, totalWords, warnings, metadata };
  }
}

/* ------------------------------- coercion ------------------------------- */

const DEFAULT_CAST: readonly [PodcastCastMember, PodcastCastMember] = [
  {
    name: "Maya",
    voice: "nova",
    voiceInstructions: "Bright, curious, quick — the energetic co-host who asks the questions.",
    persona: "a woman in her late 20s, casual smart style, expressive",
  },
  {
    name: "Deji",
    voice: "onyx",
    voiceInstructions: "Deep, laid-back, wry — the calm co-host who drops the insights.",
    persona: "a man in his 30s, relaxed hoodie-and-headphones vibe, easy grin",
  },
];

function coerceCast(value: unknown, warnings: PodcastScriptWarning[]): readonly [PodcastCastMember, PodcastCastMember] {
  const raw = Array.isArray(value) ? value : [];
  const members: PodcastCastMember[] = [];
  for (const entry of raw.slice(0, 2)) {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const record = entry as Record<string, unknown>;
      members.push({
        name: str(record["name"], `Host${members.length + 1}`),
        voice: str(record["voice"], ""),
        voiceInstructions: str(record["voiceInstructions"], "Natural conversational delivery."),
        persona: str(record["persona"], "a podcast host at a mic"),
      });
    }
  }
  while (members.length < 2) {
    warnings.push({ code: "bad-cast", message: "Cast was incomplete — filled with a default host." });
    members.push(DEFAULT_CAST[members.length as 0 | 1]);
  }

  // Valid, DIFFERENT voices — a two-hander with one voice isn't a conversation.
  const a = members[0] as PodcastCastMember;
  const b = members[1] as PodcastCastMember;
  const voiceA = VOICES.includes(a.voice) ? a.voice : DEFAULT_CAST[0].voice;
  let voiceB = VOICES.includes(b.voice) ? b.voice : DEFAULT_CAST[1].voice;
  if (voiceA !== a.voice || voiceB !== b.voice) {
    warnings.push({ code: "bad-cast", message: "A cast voice was invalid — replaced with a default." });
  }
  if (voiceB === voiceA) {
    voiceB = voiceA === "onyx" ? "nova" : "onyx";
    warnings.push({ code: "bad-cast", message: "Both hosts had the same voice — second host reassigned." });
  }
  return [
    { ...a, voice: voiceA },
    { ...b, voice: voiceB },
  ];
}

function coerceTurns(
  value: unknown,
  cast: readonly [PodcastCastMember, PodcastCastMember],
  warnings: PodcastScriptWarning[],
): readonly PodcastTurn[] {
  const raw = Array.isArray(value) ? value : [];
  const names = new Set(cast.map((member) => member.name));
  const turns: PodcastTurn[] = [];
  raw.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return;
    }
    const record = entry as Record<string, unknown>;
    const text = str(record["text"], "");
    if (text === "") {
      return;
    }
    let speaker = str(record["speaker"], "");
    if (!names.has(speaker)) {
      speaker = (cast[index % 2] ?? cast[0]).name;
      warnings.push({ code: "bad-speaker", message: `Turn ${index + 1} had an unknown speaker — assigned ${speaker}.` });
    }
    turns.push({ speaker, text, emotion: str(record["emotion"], "neutral") });
  });
  if (turns.length === 0) {
    warnings.push({ code: "parse-error", message: "No turns were parsed from the model output." });
  }
  return turns;
}

/* ------------------------------ small helpers ------------------------------ */

function countWords(text: string): number {
  return text.trim().split(/\s+/u).filter((word) => word !== "").length;
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
}

function parseJsonObject(raw: string, warnings: PodcastScriptWarning[]): Record<string, unknown> {
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
