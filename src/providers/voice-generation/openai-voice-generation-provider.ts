import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ConfigurationError } from "../../lib/errors.js";
import { probeDurationSeconds } from "../../lib/media.js";
import { withRetry } from "../../lib/retry.js";
import type { VoiceGenerationProvider } from "./voice-generation-provider.js";
import type {
  VoiceGenerationContext,
  VoiceGenerationRequest,
  GeneratedVoiceover,
  GeneratedVoiceSegment,
  VoiceGenerationWarning,
  VoiceGenerationMetadata,
} from "./types.js";

/**
 * OpenAIVoiceGenerationProvider — synthesizes narration audio with OpenAI TTS.
 *
 * This is a PRODUCTION stage, so unlike the planning providers it DOES do real
 * I/O: it calls the OpenAI audio API (native `fetch`, no SDK) and writes real
 * audio files to disk. It does NOT go through the AI Kernel — the AI Kernel is
 * for Claude TEXT generation; speech synthesis is a different modality with its
 * own endpoint. Nothing about the AI Kernel / Provider SDK is touched.
 *
 *   NarrativeScript → OpenAIVoiceGenerationProvider → OpenAI TTS
 *                  → per-segment audio files + measured timeline
 *
 * Defensive: a per-segment failure becomes a structured warning and a skipped
 * segment, not a crash. A missing/invalid API key fails fast and clearly.
 */

const OPENAI_SPEECH_URL = "https://api.openai.com/v1/audio/speech";

/** Sensible defaults: vertical short-form narration, cheap current TTS model. */
const DEFAULT_VOICE_CONTEXT: VoiceGenerationContext = {
  voice: "alloy",
  model: "gpt-4o-mini-tts",
  format: "mp3",
  speed: 1.0,
  outputDir: "output/voice",
};

export class OpenAIVoiceGenerationProvider implements VoiceGenerationProvider {
  readonly name = "openai-voice-generation-provider";

  private lastResult: GeneratedVoiceover | undefined;

  constructor(private readonly context: VoiceGenerationContext = DEFAULT_VOICE_CONTEXT) {}

  /** The most recent voiceover produced (handy for demos/telemetry). */
  get last(): GeneratedVoiceover | undefined {
    return this.lastResult;
  }

  async generate(request: VoiceGenerationRequest): Promise<GeneratedVoiceover> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || apiKey.trim() === "") {
      throw new ConfigurationError(
        "OPENAI_API_KEY is not set. Add it to .env (from https://platform.openai.com/api-keys).",
      );
    }

    const context: VoiceGenerationContext = { ...this.context, ...request.context };
    await mkdir(context.outputDir, { recursive: true });

    const warnings: VoiceGenerationWarning[] = [];
    const segments: GeneratedVoiceSegment[] = [];
    let cursor = 0;
    let totalCharacters = 0;
    const startedAt = Date.now();

    for (const [index, narrationSegment] of request.narrative.segments.entries()) {
      const segmentId = `seg-${index + 1}`;
      const text = narrationSegment.text.trim();

      if (text === "") {
        warnings.push({ code: "empty-segment", message: "Segment has no narration text.", segmentId });
        continue;
      }
      totalCharacters += text.length;

      const audioPath = join(context.outputDir, `${segmentId}.${context.format}`);

      let audio: Buffer;
      try {
        // Transient TTS failures (429/5xx/timeouts) retry with backoff; a bad
        // key (ConfigurationError) fails immediately.
        audio = await withRetry(() => synthesizeSpeech(apiKey, context, text));
      } catch (error) {
        if (error instanceof ConfigurationError) {
          throw error; // auth failure — stop clearly rather than skip everything
        }
        warnings.push({
          code: "synthesis-failed",
          message: `TTS failed: ${error instanceof Error ? error.message : String(error)}`,
          segmentId,
        });
        continue;
      }

      await writeFile(audioPath, audio);

      const plannedDuration = narrationSegment.endSecond - narrationSegment.startSecond;
      let duration = await probeDurationSeconds(audioPath);
      if (duration === undefined) {
        duration = plannedDuration > 0 ? plannedDuration : estimateSpeechSeconds(text, context.speed);
        warnings.push({
          code: "probe-failed",
          message: "Could not measure audio duration; using an estimate.",
          segmentId,
        });
      }

      segments.push({
        segmentId,
        text,
        audioPath,
        format: context.format,
        voice: context.voice,
        plannedStartSecond: narrationSegment.startSecond,
        plannedEndSecond: narrationSegment.endSecond,
        actualStartSecond: round2(cursor),
        actualEndSecond: round2(cursor + duration),
        actualDurationSeconds: round2(duration),
        characterCount: text.length,
      });

      cursor += duration;
    }

    const metadata: VoiceGenerationMetadata = {
      provider: "openai",
      model: context.model,
      voice: context.voice,
      format: context.format,
      segmentCount: segments.length,
      totalCharacters,
      latencyMs: Date.now() - startedAt,
    };

    const result: GeneratedVoiceover = {
      segments,
      totalDurationSeconds: round2(cursor),
      outputDir: context.outputDir,
      warnings,
      metadata,
    };
    this.lastResult = result;
    return result;
  }
}

/** Call OpenAI TTS and return the raw audio bytes. Never logs the key. */
async function synthesizeSpeech(
  apiKey: string,
  context: VoiceGenerationContext,
  text: string,
): Promise<Buffer> {
  const body: Record<string, unknown> = {
    model: context.model,
    voice: context.voice,
    input: text,
    response_format: context.format,
    speed: context.speed,
  };
  // Delivery style (niche voice identity) — only supported by gpt-4o-mini-tts.
  if (context.instructions && context.instructions.trim() !== "") {
    body["instructions"] = context.instructions;
  }

  const response = await fetch(OPENAI_SPEECH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await safeErrorDetail(response);
    if (response.status === 401 || response.status === 403) {
      throw new ConfigurationError(
        `OpenAI rejected the API key (${response.status}). Check OPENAI_API_KEY. ${detail}`,
      );
    }
    throw new Error(`OpenAI TTS request failed (${response.status}). ${detail}`);
  }

  const bytes = await response.arrayBuffer();
  return Buffer.from(bytes);
}

/** Read an error body without leaking secrets; tolerate non-JSON. */
async function safeErrorDetail(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 300);
  } catch {
    return "";
  }
}

/** Rough fallback estimate (~15 chars/sec at normal rate) when ffprobe is absent. */
function estimateSpeechSeconds(text: string, speed: number): number {
  const base = text.length / 15;
  return round2(base / (speed > 0 ? speed : 1));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
