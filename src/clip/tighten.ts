import type { CaptionWord } from "./captions.js";

/**
 * TIGHTENING — removing dead air and standalone filler sounds from inside a
 * clip, so 40 seconds of talking becomes 34 seconds of talking with no pauses.
 *
 * This is the cheapest retention win available: we already have word-level
 * timings, so finding the silence costs nothing. What it must NEVER do is fire
 * on the wrong content. On a football highlight the "gaps" between commentary
 * shouts ARE the match — cutting them would delete the goals. Two guards stop
 * that:
 *
 *   1. The caller only enables it for speech-led clips.
 *   2. Even then, we refuse unless words cover at least half the clip, which is
 *      true of talking and false of action footage.
 *
 * The plan is also capped at a handful of cuts. Each cut is a seam in both the
 * video and the audio, and a clip stitched from thirty fragments sounds chopped
 * no matter how precise the maths is.
 */

/** A stretch of the original clip timeline that survives into the output. */
export interface KeepRange {
  readonly start: number;
  readonly end: number;
}

export interface TightenPlan {
  /** Ranges to keep, in order, on the ORIGINAL clip-local timeline. */
  readonly ranges: readonly KeepRange[];
  /** Total seconds removed. Zero when the plan is a no-op. */
  readonly removedSeconds: number;
  /** False when we decided not to tighten at all — render the clip untouched. */
  readonly applied: boolean;
  /** Duration of the tightened clip. */
  readonly durationSeconds: number;
  /** Short explanation for logs. */
  readonly note: string;
}

export interface TightenOptions {
  /** Pauses longer than this are shortened. */
  readonly maxPauseSeconds?: number;
  /** How much of each long pause to leave behind, so speech still breathes. */
  readonly keepPauseSeconds?: number;
  /** Strip standalone "um"/"uh"/"erm" style sounds. */
  readonly removeFillers?: boolean;
  /** Hard cap on cuts — more seams than this sounds chopped. */
  readonly maxCuts?: number;
}

const DEFAULTS = {
  maxPauseSeconds: 1.0,
  keepPauseSeconds: 0.28,
  removeFillers: true,
  maxCuts: 8,
} as const;

/** Total removal below this is not worth the seams. */
const MIN_WORTHWHILE_REMOVAL = 0.8;
/** Words must cover at least this fraction of the clip for it to count as speech. */
const MIN_SPEECH_COVERAGE = 0.5;

/**
 * Only true standalone hesitation sounds. Words like "like", "so" and "actually"
 * are deliberately NOT here: they are frequently load-bearing in real sentences,
 * and cutting them mid-phrase produces audible glitches for no real gain.
 */
const FILLER_PATTERN = /^(u+m+|u+h+|e+r+m*|a+h+|m+h*m+|hmm+)[.,!?]*$/i;

const NO_OP = (duration: number, note: string): TightenPlan => ({
  ranges: [{ start: 0, end: duration }],
  removedSeconds: 0,
  applied: false,
  durationSeconds: duration,
  note,
});

/**
 * Build a tightening plan for one clip. `words` are on the clip-local timeline
 * (0 = first frame of the clip).
 */
export function planTighten(
  words: readonly CaptionWord[],
  durationSeconds: number,
  options: TightenOptions = {},
): TightenPlan {
  const maxPause = options.maxPauseSeconds ?? DEFAULTS.maxPauseSeconds;
  const keepPause = options.keepPauseSeconds ?? DEFAULTS.keepPauseSeconds;
  const removeFillers = options.removeFillers ?? DEFAULTS.removeFillers;
  const maxCuts = options.maxCuts ?? DEFAULTS.maxCuts;

  if (durationSeconds <= 0 || words.length < 5) {
    return NO_OP(durationSeconds, "too few words to tighten");
  }

  // Guard 2: is this actually a talking clip?
  const spoken = words.reduce((sum, w) => sum + Math.max(0, w.end - w.start), 0);
  if (spoken / durationSeconds < MIN_SPEECH_COVERAGE) {
    return NO_OP(durationSeconds, "not speech-dense — left untouched");
  }

  const ordered = [...words].sort((a, b) => a.start - b.start);
  const cuts: KeepRange[] = [];

  // Leading and trailing dead air: trim hard, nobody wants silence at the edges.
  const first = ordered[0]!;
  if (first.start > keepPause) cuts.push({ start: 0, end: first.start - keepPause });
  const last = ordered.at(-1)!;
  if (durationSeconds - last.end > keepPause) {
    cuts.push({ start: last.end + keepPause, end: durationSeconds });
  }

  // Internal pauses.
  for (let i = 0; i < ordered.length - 1; i++) {
    const gap = ordered[i + 1]!.start - ordered[i]!.end;
    if (gap > maxPause) {
      cuts.push({
        start: ordered[i]!.end + keepPause / 2,
        end: ordered[i + 1]!.start - keepPause / 2,
      });
    }
  }

  // Standalone fillers, with a sliver of padding so the cut lands in silence.
  if (removeFillers) {
    for (const word of ordered) {
      if (FILLER_PATTERN.test(word.word.trim())) {
        cuts.push({ start: Math.max(0, word.start - 0.04), end: Math.min(durationSeconds, word.end + 0.04) });
      }
    }
  }

  // Keep only the biggest savings, then put them back in time order.
  const chosen = cuts
    .filter((cut) => cut.end - cut.start > 0.12)
    .sort((a, b) => b.end - b.start - (a.end - a.start))
    .slice(0, maxCuts)
    .sort((a, b) => a.start - b.start);

  const merged = mergeRanges(chosen);
  const removed = merged.reduce((sum, cut) => sum + (cut.end - cut.start), 0);
  if (removed < MIN_WORTHWHILE_REMOVAL) {
    return NO_OP(durationSeconds, "nothing worth trimming");
  }

  const ranges = invert(merged, durationSeconds);
  if (ranges.length === 0) return NO_OP(durationSeconds, "trim would remove everything");

  return {
    ranges,
    removedSeconds: round2(removed),
    applied: true,
    durationSeconds: round2(durationSeconds - removed),
    note: `trimmed ${round2(removed)}s across ${merged.length} cut(s)`,
  };
}

/**
 * Map a time on the ORIGINAL clip timeline to its position in the TIGHTENED
 * output. Times inside a removed stretch collapse onto the seam. Captions must
 * be remapped through this or they drift out of sync with the audio.
 */
export function mapTime(plan: TightenPlan, second: number): number {
  if (!plan.applied) return second;
  let elapsed = 0;
  for (const range of plan.ranges) {
    if (second < range.start) return elapsed;
    if (second <= range.end) return elapsed + (second - range.start);
    elapsed += range.end - range.start;
  }
  return elapsed;
}

/** Remap a clip's caption words onto the tightened timeline, dropping cut words. */
export function remapWords(plan: TightenPlan, words: readonly CaptionWord[]): CaptionWord[] {
  if (!plan.applied) return [...words];
  const kept: CaptionWord[] = [];
  for (const word of words) {
    // A word that sits entirely inside a cut is gone (this is how fillers vanish).
    const survives = plan.ranges.some((r) => word.end > r.start && word.start < r.end);
    if (!survives) continue;
    const start = mapTime(plan, word.start);
    const end = mapTime(plan, word.end);
    if (end > start) kept.push({ word: word.word, start, end });
  }
  return kept;
}

/**
 * The ffmpeg `select` expression that keeps these ranges. Used for both the
 * video (`select`) and audio (`aselect`) streams; summing `between()` terms is
 * the standard idiom because the ranges never overlap.
 */
export function selectExpression(plan: TightenPlan): string {
  return plan.ranges.map((r) => `between(t,${round2(r.start)},${round2(r.end)})`).join("+");
}

/* -------------------------------- helpers -------------------------------- */

function mergeRanges(ranges: readonly KeepRange[]): KeepRange[] {
  const merged: KeepRange[] = [];
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) {
      merged[merged.length - 1] = { start: previous.start, end: Math.max(previous.end, range.end) };
    } else {
      merged.push(range);
    }
  }
  return merged;
}

/** The complement of `cuts` within [0, duration] — i.e. what we keep. */
function invert(cuts: readonly KeepRange[], duration: number): KeepRange[] {
  const keeps: KeepRange[] = [];
  let cursor = 0;
  for (const cut of cuts) {
    if (cut.start > cursor) keeps.push({ start: round2(cursor), end: round2(cut.start) });
    cursor = Math.max(cursor, cut.end);
  }
  if (cursor < duration) keeps.push({ start: round2(cursor), end: round2(duration) });
  return keeps.filter((range) => range.end - range.start > 0.1);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
