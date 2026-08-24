import type { AIKernel } from "../ai/index.js";
import { createClaudeAIKernel } from "../ai/index.js";
import type { TranscriptSegment } from "./transcribe.js";
import type { EnergyPeak } from "./audio-energy.js";
import type { SourceChapter } from "./source-download.js";

/**
 * Picks the best clip-worthy moments from a transcript, steered by a THEME
 * ("goals", "funniest bits", "key insights", or "auto"). Uses the loudness peaks
 * and chapters as hints. Returns raw time ranges; the caller snaps them to word
 * boundaries.
 */

export interface ClipMoment {
  readonly startSecond: number;
  readonly endSecond: number;
  /** A punchy title/hook for the clip. */
  readonly hook: string;
  /** Why this moment was chosen (for logs). */
  readonly reason: string;
}

const SYSTEM_PROMPT_ID = "clip-select.system";
const USER_PROMPT_ID = "clip-select.user";

export interface SelectInput {
  readonly theme: string;
  readonly count: number;
  readonly title: string;
  readonly description: string;
  readonly durationSeconds: number;
  readonly segments: readonly TranscriptSegment[];
  readonly peaks: readonly EnergyPeak[];
  readonly chapters: readonly SourceChapter[];
}

export class ClaudeMomentSelectionProvider {
  private readonly kernel: AIKernel;
  constructor(kernel?: AIKernel) {
    this.kernel = kernel ?? createClaudeAIKernel();
  }

  async select(input: SelectInput): Promise<readonly ClipMoment[]> {
    // Timestamps in PLAIN SECONDS (integers). Feeding m:ss made the model
    // miscompute and hallucinate out-of-range seconds; echoing seconds is exact.
    const transcript = input.segments
      .map((s) => `[${Math.round(s.start)}-${Math.round(s.end)}] ${s.text}`)
      .join("\n")
      .slice(0, 90_000); // keep the prompt bounded on very long videos

    const loud = condensePeaks(input.peaks);
    const chapters = input.chapters.map((c) => `[${Math.round(c.startSecond)}s] ${c.title}`).join("\n") || "none";

    const generated = await this.kernel.generate({
      promptId: USER_PROMPT_ID,
      systemPromptId: SYSTEM_PROMPT_ID,
      variables: {
        theme: input.theme || "auto",
        count: input.count,
        title: input.title,
        description: input.description.slice(0, 1500) || "none",
        durationSeconds: Math.round(input.durationSeconds),
        loudMoments: loud || "none",
        chapters,
        transcript,
      },
      expectedOutput: { format: "json", description: "an array of clip moments" },
      maxTokens: 1600,
    });

    return parseMoments(generated.output, input.durationSeconds);
  }
}

/**
 * Drop clips that collide in time. Keeps the model's best-first order: a later
 * pick is discarded if it overlaps one already accepted (with a small gap so
 * near-touching clips don't both survive). The result is re-sorted chronologically.
 */
export function removeOverlaps(moments: readonly ClipMoment[]): ClipMoment[] {
  const kept: ClipMoment[] = [];
  for (const m of moments) {
    const collides = kept.some((k) => m.startSecond < k.endSecond - 0.5 && m.endSecond > k.startSecond + 0.5);
    if (!collides) kept.push(m);
  }
  return kept.sort((a, b) => a.startSecond - b.startSecond);
}

/** Compress the loud-second list into readable second-ranges, e.g. "612-618, 1044". */
function condensePeaks(peaks: readonly EnergyPeak[]): string {
  if (peaks.length === 0) return "";
  const seconds = [...new Set(peaks.map((p) => p.second))].sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = seconds[0]!;
  let prev = seconds[0]!;
  for (const s of seconds.slice(1)) {
    if (s - prev <= 3) {
      prev = s;
    } else {
      ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
      start = s;
      prev = s;
    }
  }
  ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
  return ranges.slice(0, 60).join(", ");
}

function parseMoments(output: unknown, duration: number): ClipMoment[] {
  let root: unknown = output;
  if (typeof output === "string") {
    const cleaned = output.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    try {
      root = JSON.parse(cleaned);
    } catch {
      return [];
    }
  }
  const list = Array.isArray(root)
    ? root
    : Array.isArray((root as { clips?: unknown[] })?.clips)
      ? (root as { clips: unknown[] }).clips
      : [];

  const moments: ClipMoment[] = [];
  for (const item of list) {
    const o = (item ?? {}) as Record<string, unknown>;
    const start = toSeconds(o["startSecond"] ?? o["start"]);
    const end = toSeconds(o["endSecond"] ?? o["end"]);
    if (start === undefined || end === undefined) continue;
    // Drop hallucinated out-of-range picks instead of letting them collapse to 0.
    if (duration > 0 && start >= duration) continue;
    const clampedEnd = duration > 0 ? Math.min(end, duration) : end;
    if (clampedEnd - start < 8) continue; // too short to be a clip
    moments.push({
      startSecond: Math.max(0, start),
      endSecond: clampedEnd,
      hook: typeof o["hook"] === "string" ? o["hook"].slice(0, 120) : "Clip",
      reason: typeof o["reason"] === "string" ? o["reason"].slice(0, 200) : "",
    });
  }
  return moments;
}

/** Accept a number of seconds, or a "mm:ss" / "h:mm:ss" string. */
function toSeconds(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parts = value.split(":").map((p) => Number.parseFloat(p));
    if (parts.some((p) => !Number.isFinite(p))) return undefined;
    return parts.reduce((acc, p) => acc * 60 + p, 0);
  }
  return undefined;
}
