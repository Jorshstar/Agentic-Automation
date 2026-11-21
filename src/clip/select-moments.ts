import type { AIKernel } from "../ai/index.js";
import { textProviderOptions } from "../ai/text-provider.js";
import { createClaudeAIKernel } from "../ai/index.js";
import type { TranscriptSegment } from "./transcribe.js";
import type { AudioAnalysis, AudioEvent, EnergyPeak } from "./audio-energy.js";
import { eventStrength } from "./audio-energy.js";
import type { CutBurst, SceneCut } from "./scene-detect.js";
import { cutsInWindow, findCutBursts, snapToCut } from "./scene-detect.js";
import type { SourceChapter } from "./source-download.js";
import type { ClipMode, ThemePlan } from "./themes.js";

/**
 * MOMENT SELECTION — deciding WHICH parts of a long video become clips.
 *
 * Two different strategies, picked by the theme plan and by whether the source
 * actually contains speech:
 *
 *   SPEECH MODE  The transcript carries the meaning, so a language model reads
 *                it and picks moments. Audio and scene data go in as hints, and
 *                afterwards every pick is re-scored against that evidence — a
 *                pick that lands on a real crowd surge is more likely to be the
 *                moment the user asked for than one that does not.
 *
 *   ACTION MODE  There is nothing useful to read: a music-only highlight reel,
 *                a gameplay clip, a match with sparse commentary. The old
 *                pipeline returned ZERO clips here, which is the single biggest
 *                reason "clip the goals" used to fail. Instead we find moments
 *                from the signal itself — a sustained crowd surge followed by a
 *                burst of replay cuts is a goal, and detecting it costs nothing.
 *
 * Both paths return the same scored, de-overlapped, chronological list.
 */

export interface ClipMoment {
  readonly startSecond: number;
  readonly endSecond: number;
  /** A punchy title/hook for the clip. */
  readonly hook: string;
  /** Why this moment was chosen (for logs and the delivery caption). */
  readonly reason: string;
  /** 0-100 confidence that this is a strong clip for the requested theme. */
  readonly score: number;
  /** Concrete signals backing the pick, e.g. "crowd surge +14dB". */
  readonly evidence: readonly string[];
}

const SYSTEM_PROMPT_ID = "clip-select.system";
const USER_PROMPT_ID = "clip-select.user";

export interface SelectInput {
  readonly plan: ThemePlan;
  /** Effective mode — may differ from plan.mode when the source has no speech. */
  readonly mode: ClipMode;
  readonly count: number;
  readonly title: string;
  readonly description: string;
  readonly durationSeconds: number;
  readonly segments: readonly TranscriptSegment[];
  readonly audio: AudioAnalysis;
  readonly sceneCuts: readonly SceneCut[];
  readonly chapters: readonly SourceChapter[];
  /** Surfaces a degraded path (e.g. the selector model failed) to the caller. */
  readonly onWarn?: (message: string) => void;
  /**
   * Progress notes. Worth having because "it only sent me three goals" and "it
   * sent me three things that are not goals" look identical from the chat, and
   * the difference is whether the model offered five picks or three.
   */
  readonly onNote?: (message: string) => void;
}

export class ClipMomentSelector {
  private readonly kernel: AIKernel;

  constructor(kernel?: AIKernel) {
    this.kernel = kernel ?? createClaudeAIKernel();
  }

  async select(input: SelectInput): Promise<readonly ClipMoment[]> {
    if (input.mode === "action") {
      return selectFromSignals(input);
    }

    let picks: readonly ClipMoment[] = [];
    try {
      picks = await this.selectFromTranscript(input);
    } catch (error) {
      // A selector failure must NOT end the job. By this point the source has
      // been downloaded and analysed — the expensive part is already paid for —
      // and the loudness and scene signals are still sitting right there. An
      // exhausted API balance or a provider outage should cost quality, not the
      // whole run.
      input.onWarn?.(
        `⚠️ Moment selection failed (${short(error)}). Falling back to audio detection.`,
      );
      return selectFromSignals(input);
    }

    if (picks.length > 0) return picks;
    // The model ran but liked nothing. Same fallback, same reason.
    return selectFromSignals(input);
  }

  private async selectFromTranscript(input: SelectInput): Promise<readonly ClipMoment[]> {
    // Timestamps go in as PLAIN SECONDS. Feeding m:ss made the model miscompute
    // and hallucinate out-of-range values; echoing integers back is exact.
    const transcript = input.segments
      .map((s) => `[${Math.round(s.start)}-${Math.round(s.end)}] ${s.text}`)
      .join("\n")
      .slice(0, 90_000); // keep the prompt bounded on very long videos

    const generated = await this.kernel.generate({
      promptId: USER_PROMPT_ID,
      systemPromptId: SYSTEM_PROMPT_ID,
      variables: {
        theme: input.plan.theme,
        themeGuidance: input.plan.guidance,
        count: input.count,
        title: input.title,
        description: input.description.slice(0, 1500) || "none",
        durationSeconds: Math.round(input.durationSeconds),
        minSeconds: input.plan.duration.min,
        idealSeconds: input.plan.duration.ideal,
        maxSeconds: input.plan.duration.max,
        loudMoments: condensePeaks(input.audio.peaks) || "none",
        surges: describeEvents(input.audio.events, input.sceneCuts) || "none",
        chapters:
          input.chapters.map((c) => `[${Math.round(c.startSecond)}s] ${c.title}`).join("\n") || "none",
        transcript,
      },
      expectedOutput: { format: "json", description: "an array of scored clip moments" },
      maxTokens: 2000,
      // Selection is text work, so it can run on a custom endpoint. The
      // prompt registry still lists Claude as its preferred provider for other
      // callers; an explicit provider on the request overrides that.
      ...textProviderOptions("CLIP_SELECT_MODEL"),
    });

    const parsed = parseMoments(generated.output, input.durationSeconds, input.plan);
    const scored = parsed.map((moment) => addEvidence(moment, input));
    const kept = finalize(scored, input);

    // Where the shortfall came from, in one line: the model finding little, or
    // this code discarding what it found, are different problems.
    if (kept.length < input.count) {
      const dropped = parsed.length - kept.length;
      input.onNote?.(
        `   ${input.count} asked for, ${parsed.length} offered` +
          `${dropped > 0 ? `, ${dropped} dropped (too short, overlapping, or out of range)` : ""}.`,
      );
    }
    return kept;
  }
}

/* --------------------------- signal-driven path --------------------------- */

/**
 * Find moments with no language model at all, from loudness and cuts.
 *
 * TWO detectors, because one video type defeats each of them.
 *
 * LOUDNESS works on a full broadcast: a goal is a sustained crowd surge against
 * a quiet baseline, and directors always follow it with replays — so a surge
 * with several scene cuts behind it is near-certainly what the user wants.
 *
 * It fails completely on a HIGHLIGHTS PACKAGE, which is the most common thing
 * anyone actually asks to clip goals from. Such a video is loud from the first
 * frame, so nothing rises above its own baseline: a real twelve-minute "ALL
 * GOALS" upload produced seven audio events and one sustained surge, and the
 * selector fell through to evenly-spaced guesses — five clips, not one goal
 * among them.
 *
 * CUT BURSTS cover that case. The same video had 28 scene cuts, and they were
 * not spread evenly: they clustered, because an editor cuts hard into each goal
 * and then through its replay angles. Those clusters are the goals, and they are
 * free to detect. They are candidates in their own right here, not a bonus on an
 * audio event that may never fire.
 *
 * Both detectors feed one ranked list, so whichever signal the video actually
 * carries is the one that decides.
 */
export function selectFromSignals(input: SelectInput): readonly ClipMoment[] {
  const { plan } = input;
  const events = [...input.audio.events];
  // input.mode, not plan.mode: a speech theme on a wordless source has already
  // been degraded to action by the caller, and that is exactly the case with no
  // transcript to fall back on.
  const action = input.mode === "action" || plan.mode === "action";
  const bursts = action ? findCutBursts(input.sceneCuts) : [];
  if (events.length === 0 && bursts.length === 0) return evenlySpacedFallback(input);

  // For action themes a sustained surge is the signal; brief spikes are noise.
  const candidates = action ? preferSurges(events) : events;

  const fromAudio = candidates.map((event) => {
    const replayCuts = cutsInWindow(input.sceneCuts, event.endSecond, event.endSecond + 10);
    const strength = eventStrength(event) + replayCuts * 4 * (plan.weights.scene * 2);

    const rawStart = event.startSecond - plan.preRollSeconds;
    const rawEnd = event.endSecond + plan.postRollSeconds;
    // Start on a clean edit when one is nearby, so the clip doesn't open
    // mid-shot. Never move it far enough to lose the build-up.
    const snappedStart = snapToCut(rawStart, input.sceneCuts, 1.5);
    const { start, end } = clampToDuration(snappedStart, rawEnd, plan, input.durationSeconds);

    const evidence = [
      `${event.kind === "surge" ? "crowd surge" : "spike"} +${event.prominenceDb}dB for ${event.durationSeconds}s`,
    ];
    if (replayCuts >= 3) evidence.push(`${replayCuts} replay cuts after`);

    return {
      startSecond: start,
      endSecond: end,
      hook: hookFromTranscript(input, start, end) ?? defaultHook(plan.theme),
      reason: event.kind === "surge" ? "sustained crowd reaction" : "sharp audio spike",
      score: strength, // normalised below
      evidence,
    };
  });

  const fromCuts = bursts.map((burst) => momentFromBurst(burst, input));
  // Audio events and cut bursts often describe the SAME goal from two angles.
  // finalize() ranks everything together and drops the weaker of any overlap,
  // so the duplicate costs nothing and the stronger evidence wins.
  return finalize([...fromAudio, ...fromCuts], input);
}

/**
 * Turn a cluster of cuts into a clip window.
 *
 * The geometry matters. In an edited package the cuts come AFTER the thing they
 * are about — the editor cuts away from live play to the replays — so the goal
 * itself sits just before the first cut of the burst. Starting at the burst
 * would hand back nothing but replays of a goal the viewer never saw.
 */
function momentFromBurst(burst: CutBurst, input: SelectInput): ClipMoment {
  const { plan } = input;
  // One extra second of lead over the audio path: a cut burst marks the moment
  // less precisely than a roar does, so the build-up needs a little more room.
  const rawStart = burst.startSecond - plan.preRollSeconds - 1;
  const rawEnd = burst.endSecond + plan.postRollSeconds;
  const { start, end } = clampToDuration(
    snapToCut(rawStart, input.sceneCuts, 1.5),
    rawEnd,
    plan,
    input.durationSeconds,
  );

  // A burst with a loud moment in it is a goal; a burst alone might be a
  // montage or a graphics sting, so it scores lower.
  const loud = input.audio.events.find((event) => event.endSecond > start && event.startSecond < end);
  const evidence = [`${burst.cuts} cuts in ${round1(burst.endSecond - burst.startSecond)}s (replay burst)`];
  if (loud) evidence.push(`+${loud.prominenceDb}dB over it`);

  return {
    startSecond: start,
    endSecond: end,
    hook: hookFromTranscript(input, start, end) ?? defaultHook(plan.theme),
    reason: "replay burst — the edit marks this as a highlight",
    score: burst.cuts * 6 * (plan.weights.scene * 2) + (loud ? eventStrength(loud) * 0.5 : 0),
    evidence,
  };
}

/**
 * Keep sustained surges. If there are too few to fill the request we top up with
 * the strongest spikes rather than returning nothing.
 */
function preferSurges(events: readonly AudioEvent[]): AudioEvent[] {
  const surges = events.filter((e) => e.kind === "surge");
  if (surges.length >= 3) return surges;
  const spikes = events.filter((e) => e.kind === "spike").slice(0, 8);
  return [...surges, ...spikes];
}

/**
 * Last resort: no audio events at all, and nothing the model wanted. Rather than
 * return an empty list — which is what the old pipeline did, and what the user
 * experiences as the bot ignoring them — hand back something to react to, with
 * an honest low score and evidence saying there was nothing to go on.
 *
 * Two rules, both learned from a 56-second TikTok that came back as two clips
 * overlapping by ten seconds:
 *
 *   1. Clips must NOT overlap. This path used to divide the usable range by the
 *      clip count without accounting for clip LENGTH, so on a short source the
 *      windows ran straight through each other and the viewer got the same
 *      moment twice.
 *   2. A short source is ONE clip. If the whole video is barely longer than a
 *      single clip, slicing it into pieces produces near-duplicates of the same
 *      thing; the video itself is the clip.
 */
function evenlySpacedFallback(input: SelectInput): readonly ClipMoment[] {
  const { plan } = input;
  const length = Math.min(plan.duration.ideal, input.durationSeconds);
  const evidence = ["no audio events detected"];

  // Not enough room for two clips with any separation: return the whole thing.
  if (input.durationSeconds < length * 3) {
    return [
      {
        startSecond: 0,
        endSecond: Math.min(input.durationSeconds, plan.duration.max),
        hook: defaultHook(plan.theme),
        reason: "short source — the whole video is the clip",
        score: 45,
        evidence,
      },
    ];
  }

  // How many non-overlapping clips of this length actually fit, leaving a gap
  // between each so they are distinct moments rather than a continuous cut.
  const fits = Math.floor(input.durationSeconds / length);
  const count = Math.max(1, Math.min(input.count, fits - 1, 4));
  const gap = (input.durationSeconds - count * length) / (count + 1);

  return Array.from({ length: count }, (_, i) => {
    const start = round1(gap * (i + 1) + length * i);
    return {
      startSecond: start,
      endSecond: round1(Math.min(start + length, input.durationSeconds)),
      hook: defaultHook(plan.theme),
      reason: "evenly spaced (no usable signal)",
      score: 40,
      evidence,
    };
  });
}

/* ------------------------------ scoring ------------------------------ */

/**
 * Cross-check a model's pick against the measured signals. A clip that contains
 * a real crowd surge, or sits on a replay burst, is more likely to be what the
 * theme asked for — and for loudness-weighted themes that should move the
 * ranking. For a speech theme like "emotional" the loudness weight is near zero,
 * so this barely nudges anything, which is correct.
 */
function addEvidence(moment: ClipMoment, input: SelectInput): ClipMoment {
  const evidence: string[] = [...moment.evidence];
  let bonus = 0;

  const inside = input.audio.events.filter(
    (e) => e.endSecond > moment.startSecond && e.startSecond < moment.endSecond,
  );
  const strongest = inside.sort((a, b) => eventStrength(b) - eventStrength(a))[0];
  if (strongest) {
    evidence.push(
      `${strongest.kind === "surge" ? "crowd surge" : "spike"} +${strongest.prominenceDb}dB inside`,
    );
    bonus += Math.min(15, strongest.prominenceDb) * input.plan.weights.loudness;
  }

  const cuts = cutsInWindow(input.sceneCuts, moment.startSecond, moment.endSecond);
  if (cuts >= 3) {
    evidence.push(`${cuts} scene cuts`);
    bonus += Math.min(10, cuts) * input.plan.weights.scene;
  }

  return { ...moment, score: moment.score + bonus, evidence };
}

/**
 * De-overlap, rank, trim to the requested count, normalise scores to 0-100, and
 * return in chronological order (the order a user wants to receive them).
 */
function finalize(moments: readonly ClipMoment[], input: SelectInput): readonly ClipMoment[] {
  const valid = moments
    .map((m) => ({
      ...m,
      startSecond: Math.max(0, m.startSecond),
      endSecond: Math.min(input.durationSeconds || m.endSecond, m.endSecond),
    }))
    .filter((m) => m.endSecond - m.startSecond >= input.plan.duration.min * 0.6);

  const ranked = [...valid].sort((a, b) => b.score - a.score);
  const kept = removeOverlaps(ranked).slice(0, input.count);
  return normaliseScores(kept).sort((a, b) => a.startSecond - b.startSecond);
}

/**
 * Map raw strengths onto a readable 0-100 band. Raw values come from different
 * scales depending on the path (model scores vs. decibel-derived strengths), so
 * we rank-normalise rather than pretend the raw number means anything absolute.
 * The band stops at 97 because claiming certainty on a heuristic is dishonest.
 */
function normaliseScores(moments: readonly ClipMoment[]): ClipMoment[] {
  if (moments.length === 0) return [];
  const scores = moments.map((m) => m.score);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const span = max - min;
  return moments.map((moment) => {
    const normalised = span < 0.01 ? 0.75 : (moment.score - min) / span;
    return { ...moment, score: Math.round(60 + normalised * 37) };
  });
}

/**
 * Drop clips that collide in time. Input must be best-first: a later pick is
 * discarded if it overlaps one already accepted (with a small gap so
 * near-touching clips don't both survive).
 */
export function removeOverlaps(moments: readonly ClipMoment[]): ClipMoment[] {
  const kept: ClipMoment[] = [];
  for (const moment of moments) {
    const collides = kept.some(
      (k) => moment.startSecond < k.endSecond - 0.5 && moment.endSecond > k.startSecond + 0.5,
    );
    if (!collides) kept.push(moment);
  }
  return kept;
}

/* ------------------------------ formatting ------------------------------ */

/** Compress the loud-second list into readable ranges, e.g. "612-618, 1044". */
export function condensePeaks(peaks: readonly EnergyPeak[]): string {
  if (peaks.length === 0) return "";
  const seconds = [...new Set(peaks.map((p) => p.second))].sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = seconds[0]!;
  let previous = seconds[0]!;
  for (const second of seconds.slice(1)) {
    if (second - previous <= 3) {
      previous = second;
    } else {
      ranges.push(start === previous ? `${start}` : `${start}-${previous}`);
      start = second;
      previous = second;
    }
  }
  ranges.push(start === previous ? `${start}` : `${start}-${previous}`);
  return ranges.slice(0, 60).join(", ");
}

/**
 * The strongest events described in words the model can act on, including the
 * replay-cut count — which is the detail that separates a goal from a shout.
 */
export function describeEvents(events: readonly AudioEvent[], cuts: readonly SceneCut[]): string {
  return events
    .slice(0, 25)
    .map((event) => {
      const replays = cutsInWindow(cuts, event.endSecond, event.endSecond + 10);
      const replayNote = replays >= 3 ? `, ${replays} replay cuts after` : "";
      return `${Math.round(event.startSecond)}-${Math.round(event.endSecond)}s ${event.kind} +${event.prominenceDb}dB${replayNote}`;
    })
    .join("; ");
}

/** Build a hook from whatever was said inside the window, if anything. */
function hookFromTranscript(input: SelectInput, start: number, end: number): string | undefined {
  const text = input.segments
    .filter((s) => s.end > start && s.start < end)
    .map((s) => s.text)
    .join(" ")
    .trim();
  if (text.length < 12) return undefined;
  const words = text.split(/\s+/u).slice(0, 9).join(" ");
  return words.length > 4 ? words : undefined;
}

function defaultHook(theme: string): string {
  return theme === "auto" ? "Best moment" : theme.replace(/\b\w/gu, (c) => c.toUpperCase()).slice(0, 60);
}

/** Force a window inside the theme's length bounds and the video's own length. */
function clampToDuration(
  start: number,
  end: number,
  plan: ThemePlan,
  videoDuration: number,
): { start: number; end: number } {
  let from = Math.max(0, start);
  let to = end;
  if (to - from < plan.duration.min) to = from + plan.duration.min;
  if (to - from > plan.duration.max) to = from + plan.duration.max;
  if (videoDuration > 0 && to > videoDuration) {
    to = videoDuration;
    from = Math.max(0, to - plan.duration.ideal);
  }
  return { start: round1(from), end: round1(to) };
}

/* -------------------------------- parsing -------------------------------- */

function parseMoments(output: unknown, duration: number, plan: ThemePlan): ClipMoment[] {
  let root: unknown = output;
  if (typeof output === "string") {
    const cleaned = output.trim().replace(/^```(?:json)?/iu, "").replace(/```$/u, "").trim();
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
    const record = (item ?? {}) as Record<string, unknown>;
    const start = toSeconds(record["startSecond"] ?? record["start"]);
    const end = toSeconds(record["endSecond"] ?? record["end"]);
    if (start === undefined || end === undefined) continue;
    // Drop hallucinated out-of-range picks instead of letting them collapse to 0.
    if (duration > 0 && start >= duration) continue;

    const clampedEnd = duration > 0 ? Math.min(end, duration) : end;
    if (clampedEnd - start < plan.duration.min * 0.6) continue;

    const rawScore = record["score"];
    const score =
      typeof rawScore === "number" && Number.isFinite(rawScore)
        ? Math.min(100, Math.max(0, rawScore))
        : 70;

    moments.push({
      startSecond: Math.max(0, start),
      // Honour the theme's maximum: the model is told the bounds but does drift.
      endSecond: Math.min(clampedEnd, start + plan.duration.max),
      hook: typeof record["hook"] === "string" ? record["hook"].slice(0, 120) : "Clip",
      reason: typeof record["reason"] === "string" ? record["reason"].slice(0, 200) : "",
      score,
      evidence: [],
    });
  }
  return moments;
}

/** Accept a number of seconds, or a "mm:ss" / "h:mm:ss" string. */
function toSeconds(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parts = value.split(":").map((part) => Number.parseFloat(part));
    if (parts.length === 0 || parts.some((part) => !Number.isFinite(part))) return undefined;
    return parts.reduce((accumulator, part) => accumulator * 60 + part, 0);
  }
  return undefined;
}

function short(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 160);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Backwards-compatible alias. The old class name is still referenced by the
 * cloud task; keeping it avoids a breaking change at the call site.
 */
export { ClipMomentSelector as ClaudeMomentSelectionProvider };
