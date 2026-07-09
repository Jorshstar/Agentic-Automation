import type { AIKernel, AIGenerateRequest } from "../ai/index.js";
import type { ContentBrief } from "../studio/content-brief.js";
import { NICHE_PROFILES } from "../config/niche-profiles.js";
import type { NicheProfile } from "../config/niche-profiles.js";
import { isVideoFormat } from "../studio/formats.js";
import type { PresetNiche } from "../types/index.js";

/**
 * Command parser — turns a chat message into a studio command via one cheap AI
 * Kernel call. Defensive like every other parser here: enum coercion + a
 * fallback that treats the whole message as create-instructions, so a parsing
 * hiccup can never eat a command (worst case you just get asked to confirm).
 */

export type CommandAction = "create" | "preview" | "status" | "help" | "chat";

export interface ParsedCommand {
  readonly action: CommandAction;
  /** Present for create/preview. */
  readonly brief?: ContentBrief;
  /** Present for chat/help. */
  readonly reply: string;
  /** Loud caveat to surface in the plan (e.g. requested length out of range). */
  readonly note?: string;
}

const COMMAND_PROMPT_ID = "command.user";
const VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "onyx", "nova", "sage", "shimmer", "verse"];
const ACTIONS: readonly CommandAction[] = ["create", "preview", "status", "help", "chat"];

export async function parseCommand(kernel: AIKernel, message: string): Promise<ParsedCommand> {
  // Fast paths — no AI needed for bare keywords.
  const bare = message.trim().toLowerCase();
  if (bare === "/status" || bare === "status") {
    return { action: "status", reply: "" };
  }
  if (bare === "/help" || bare === "help" || bare === "/start") {
    return { action: "help", reply: "" };
  }

  const generateRequest: AIGenerateRequest = {
    promptId: COMMAND_PROMPT_ID,
    variables: {
      message,
      niches: Object.keys(NICHE_PROFILES).join(", "),
      voices: VOICES.join(", "),
    },
    expectedOutput: { format: "json", description: "a parsed studio command" },
    maxTokens: 500,
  };

  try {
    const generated = await kernel.generate<string>(generateRequest);
    return toCommand(generated.output, message);
  } catch {
    // Parser down? Treat the message as instructions — confirmation still guards spend.
    return { action: "create", brief: { instructions: message }, reply: "" };
  }
}

function toCommand(raw: string, original: string): ParsedCommand {
  const root = parseJsonObject(raw);
  const action = oneOf(root["action"], ACTIONS, "create");

  if (action === "status" || action === "help") {
    return { action, reply: "" };
  }
  if (action === "chat") {
    return { action, reply: str(root["reply"], "I make videos — tell me what to create!") };
  }

  const instructions = str(root["instructions"], original);
  const nicheRaw = str(root["niche"], "none");
  const niche = nicheRaw in NICHE_PROFILES ? (nicheRaw as PresetNiche) : undefined;
  const duration = num(root["durationSeconds"]);
  const voiceRaw = str(root["voice"], "none");
  const visualStyle = str(root["visualStyle"], "none");
  const musicMood = str(root["musicMood"], "none");

  const identity: Partial<Omit<NicheProfile, "niche">> = {
    ...(VOICES.includes(voiceRaw) ? { voice: voiceRaw } : {}),
    ...(visualStyle !== "none" ? { visualStyle } : {}),
    ...(musicMood !== "none" ? { musicMood } : {}),
  };

  // Duration honesty: NEVER silently reinterpret an out-of-range request.
  // In range (15s-10min) → use it. Out of range → default length + a LOUD note.
  let note: string | undefined;
  let durationSeconds: number | undefined;
  if (duration >= 15 && duration <= 600) {
    durationSeconds = duration;
  } else if (duration > 600) {
    note =
      `you asked for ~${Math.round(duration / 60)} minutes — my current maximum is 10 minutes ` +
      `per video, so I've planned the default 65s instead. Say "make it 10 minutes" (or any ` +
      `length up to 10 minutes) if you want longer.`;
  } else if (duration > 0) {
    note = `you asked for ${duration}s — my minimum is 15s, so I've planned the default 65s instead.`;
  }

  const formatRaw = str(root["format"], "narrated-short");
  const format = isVideoFormat(formatRaw) ? formatRaw : "narrated-short";

  const brief: ContentBrief = {
    instructions,
    format,
    ...(niche !== undefined ? { niche } : {}),
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    ...(Object.keys(identity).length > 0 ? { identity } : {}),
    exactTitle: root["exactTitle"] === true,
  };

  return { action, brief, reply: "", ...(note !== undefined ? { note } : {}) };
}

/* ------------------------------ parse helpers ------------------------------ */

function parseJsonObject(raw: string): Record<string, unknown> {
  const withoutFences = raw.replace(/```(?:json)?/giu, "").trim();
  const start = withoutFences.indexOf("{");
  const end = withoutFences.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(withoutFences.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}
