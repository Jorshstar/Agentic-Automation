import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveMediaTool } from "../lib/binaries.js";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { probeJson } from "../lib/media.js";
import { sampleLuma } from "./overlay.js";
import { estimateSubject, estimateSubjectOverTime } from "./subject.js";
import type { ThemePlan } from "./themes.js";

const execFileAsync = promisify(execFile);

/**
 * REFRAMING — optionally turning a 16:9 source into a 9:16 vertical clip.
 *
 * The DEFAULT is "native": don't. The clip keeps the source's exact dimensions
 * and aspect, so it looks identical to the original video, because it is the
 * original video with a time range cut out of it.
 *
 * Converting to vertical is opt-in, because it cannot be done without loss: a
 * 16:9 frame on a 9:16 canvas either fills 31.6% of the height with the rest
 * padded, or fills the screen by cropping the sides away. Both are real changes
 * to what the viewer sees, so the user chooses.
 *
 * Subject-tracked cropping is available but opt-in, because it fills the screen
 * by discarding the sides of the frame. When it is on, the subject is located by
 * MEASURING MOTION: in a talking-head shot the person moves and the room does
 * not, so the centre of mass of per-column change is the subject. Deterministic,
 * free, and no model involved — see subject.ts for why the vision call that used
 * to do this was removed.
 *
 * Three layouts, chosen by content type:
 *
 *   - "crop"     subject-tracked crop. Fills the screen. Talking heads, reactions,
 *                interviews — anything where one person carries the frame.
 *   - "fit-top"  whole frame kept, parked in the upper area over a blurred fill,
 *                captions below it. Used for WIDE action (football, gameplay)
 *                where cropping to 9:16 would throw away most of the pitch.
 *   - "fit"      whole frame centred over a blurred fill. The safe fallback, and
 *                what we use whenever the vision pass is unavailable or unsure.
 *
 * Nothing here throws. Every failure path degrades to "fit", which always works.
 */

export type ReframeKind = "native" | "crop" | "crop-wide" | "fit-top" | "fit" | "passthrough";

export interface ReframeKeyframe {
  /** Seconds from the start of the CLIP (not the source video). */
  readonly second: number;
  /** Horizontal centre of the subject, 0 = left edge, 1 = right edge. */
  readonly xCenter: number;
}

export interface ReframePlan {
  readonly kind: ReframeKind;
  /** Source dimensions, when we could measure them. */
  readonly sourceWidth?: number;
  readonly sourceHeight?: number;
  /** For "crop": the smoothed path the crop window follows. Empty = static. */
  readonly keyframes: readonly ReframeKeyframe[];
  /** Human-readable note for logs ("motion 3 window(s), static crop @ 0.72"). */
  readonly note: string;
}

export const FIT_PLAN: ReframePlan = { kind: "fit", keyframes: [], note: "blurred fit" };

/**
 * The default: hand the source back at its own size. No vertical canvas, no
 * padding, no blur, no crop — the clip looks exactly like the video it came
 * from, because it IS the video it came from, trimmed.
 */
export const NATIVE_PLAN: ReframePlan = { kind: "native", keyframes: [], note: "original size, untouched" };

/** Frames sampled when a diagnostic needs to show what was measured. */
const MAX_SAMPLES = 7;
const MIN_SAMPLES = 3;
/**
 * Belt and braces: estimateSubject already returns nothing below its own
 * threshold, so this only guards against the two drifting apart.
 */
const MIN_CONFIDENCE = 0.7;
/**
 * If the subject moves less than this fraction of frame width across the whole
 * clip, hold the crop still. A crop that drifts a few pixels looks like a
 * wobble, which is worse than no movement at all.
 */
const STATIC_DEVIATION = 0.05;

export type ReframeMode = "native" | "smart" | "wide" | "fit" | "fit-top";

/** Aspect of the crop window for "wide": 4:5, the tallest format that still
 * keeps a useful amount of the scene. It fills ~70% of the frame height versus
 * 31.6% for a whole 16:9 frame, so the picture reads as full without discarding
 * as much of the sides as a 9:16 crop does. */
export const WIDE_CROP_ASPECT = 4 / 5;

/**
 * Which layout a theme gets by default.
 *
 * THE PICTURE IS NEVER ALTERED. The default layouts ("fit" and "fit-top") keep
 * every pixel of the original frame: the whole picture is placed on the vertical
 * canvas over a blurred copy of ITSELF, so nothing is cut off and nothing is
 * repainted. The blur only ever fills the empty bars — it never touches the
 * picture sitting on top of it.
 *
 * Subject-tracked cropping ("smart") is therefore OPT-IN. It fills the screen
 * and looks more native on TikTok, but it does so by throwing away the left and
 * right edges of the frame, which is a real change to what the viewer sees.
 * Turn it on per run with CLIP_REFRAME=smart, or per job with the `reframe`
 * field.
 *
 * To be explicit about the one thing people assume: no AI model generates,
 * redraws, upscales or "enhances" any frame — and since the vision call was
 * removed, no model touches this path at all. Every pixel operation is ffmpeg.
 */
export function defaultModeForTheme(_plan: ThemePlan): ReframeMode {
  const override = parseLayoutInstruction(process.env.CLIP_REFRAME ?? "");
  if (override) return override;
  // DEFAULT: leave the frame alone.
  //
  // A 16:9 source forced onto a 9:16 canvas can only ever fill 31.6% of the
  // height, and the remaining two thirds have to be filled with something —
  // blurred bars that look nothing like the original. Converting to vertical is
  // therefore a choice, not a requirement, and it is the user's to make. Ask for
  // it in words ("full screen", "vertical", "like tiktok") and you get it.
  return "native";
}

/**
 * Read a layout out of plain words, so the user can say what they want instead
 * of learning mode names: "clip the goals but show the full video", "zoom in on
 * him", "don't cut the sides".
 *
 * Returns undefined when nothing in the text names a layout, which leaves the
 * theme's default in place.
 */
export function parseLayoutInstruction(text: string): ReframeMode | undefined {
  const value = text.trim().toLowerCase();
  if (value === "") return undefined;

  // Exact mode names first, so a config value always wins over prose.
  if (value === "native" || value === "original" || value === "as-is") return "native";
  if (value === "smart" || value === "crop" || value === "zoom") return "smart";
  if (value === "wide" || value === "balanced") return "wide";
  if (value === "fit" || value === "whole" || value === "full-frame") return "fit";
  if (value === "fit-top" || value === "top") return "fit-top";

  // An explicit "keep it as it was" beats everything else.
  if (
    /\b(original|as.?is|don'?t change|do not change|same size|leave it|unchanged|no bars|no blur|no padding|don'?t convert)\b/u.test(
      value,
    )
  ) {
    return "native";
  }

  // Asking for a vertical/short-form frame is what opts IN to conversion.
  if (/\b(vertical|portrait|9.?16|short|reel|story)\b/u.test(value)) return "smart";

  // "show everything" wins over "full screen": a request to keep the whole
  // picture is specific, while "full" on its own is ambiguous.
  if (
    /\b(show (me )?(the )?(whole|full|entire|complete)( video| frame| picture| thing)?|whole frame|entire frame|don'?t crop|do not crop|no crop|nothing cut|uncropped|keep the sides|full picture)\b/u.test(
      value,
    )
  ) {
    return "fit";
  }
  if (/\b(wide|wider|show more|more of the (scene|room|stage)|less zoom|zoom out)\b/u.test(value)) {
    return "wide";
  }
  if (
    /\b(full ?screen|fill (the )?(screen|frame)|like ?tik ?tok|tiktok style|zoom(ed)? in|close ?up|crop(ped)?( in)?|fill it)\b/u.test(
      value,
    )
  ) {
    return "smart";
  }
  return undefined;
}

export interface PlanReframeInput {
  readonly sourcePath: string;
  readonly startSecond: number;
  readonly endSecond: number;
  readonly workDir: string;
  readonly mode: ReframeMode;
}

/**
 * Decide how one clip should be reframed. Safe to call on every clip: when the
 * mode is not "smart" it returns immediately without spending anything.
 */
export async function planReframe(input: PlanReframeInput): Promise<ReframePlan> {
  // Cheapest possible path: nothing to measure, nothing to decide, nothing to
  // spend. The frame is kept exactly as it is.
  if (input.mode === "native") return NATIVE_PLAN;

  const dimensions = await probeDimensions(input.sourcePath);
  const sourceWidth = dimensions?.width;
  const sourceHeight = dimensions?.height;

  // Already vertical (or taller): there is nothing to reframe, so scale only.
  if (sourceWidth && sourceHeight && sourceWidth / sourceHeight <= 9 / 16 + 0.01) {
    return { kind: "passthrough", sourceWidth, sourceHeight, keyframes: [], note: "source already vertical" };
  }

  if (input.mode === "fit") return { ...FIT_PLAN, sourceWidth, sourceHeight };
  if (input.mode === "fit-top") {
    return { kind: "fit-top", sourceWidth, sourceHeight, keyframes: [], note: "whole frame, parked high" };
  }

  if (!sourceWidth || !sourceHeight) {
    return { ...FIT_PLAN, note: "could not probe source size — blurred fit" };
  }

  const duration = Math.max(1, input.endSecond - input.startSecond);
  try {
    const luma = await sampleLuma({
      sourcePath: input.sourcePath,
      startSecond: input.startSecond,
      endSecond: input.endSecond,
      workDir: input.workDir,
    });
    const kind: ReframeKind = input.mode === "wide" ? "crop-wide" : "crop";

    // Enough frames to see movement across the clip, but few enough windows
    // that each still has frames to compare.
    const windows = Math.min(6, Math.max(2, Math.round(duration / 5)));
    const samples = estimateSubjectOverTime(luma, windows)
      .filter((sample) => sample.estimate && sample.estimate.confidence >= MIN_CONFIDENCE)
      .map((sample) => ({
        second: sample.at * duration,
        xCenter: sample.estimate!.xCenter,
      }));

    if (samples.length === 0) {
      // Nothing to lock onto — a static shot, a crowd, a camera pan. Centre is a
      // guess, and guessing is how a crop quietly cuts the speaker out, so keep
      // the whole frame instead.
      return { ...FIT_PLAN, sourceWidth, sourceHeight, note: "no clear subject — blurred fit" };
    }

    const smoothed = smooth(samples);
    const deviation = spread(smoothed.map((keyframe) => keyframe.xCenter));

    if (deviation < STATIC_DEVIATION) {
      const mean = smoothed.reduce((sum, k) => sum + k.xCenter, 0) / smoothed.length;
      return {
        kind,
        sourceWidth,
        sourceHeight,
        keyframes: [{ second: 0, xCenter: mean }],
        note: `motion ${samples.length} window(s), static crop @ ${mean.toFixed(2)}`,
      };
    }

    return {
      kind,
      sourceWidth,
      sourceHeight,
      keyframes: smoothed,
      note: `motion ${samples.length} window(s), tracking crop (${smoothed.length} keyframes)`,
    };
  } catch {
    return { ...FIT_PLAN, sourceWidth, sourceHeight, note: "subject detection failed — blurred fit" };
  }
}

/* ------------------------------ diagnostics ------------------------------ */

/** What the detector measured, for inspection. */
export interface SubjectProbe {
  readonly second: number;
  /** Clip-local time this window is centred on. */
  readonly localSecond: number;
  readonly framePath: string;
  readonly xCenter?: number;
  readonly confidence?: number;
}

/**
 * Run subject detection and report the raw result, with a frame from each
 * window saved so a human can see whether the answer is on the speaker.
 *
 * This exists because the previous detector failed invisibly: it returned
 * exactly 0.50 at 0.90 confidence for every frame, which looks like success in
 * a log and produces a plausible centre crop. Used by `npm run clip:reframe`.
 */
export async function probeSubjects(input: PlanReframeInput): Promise<readonly SubjectProbe[]> {
  const duration = Math.max(1, input.endSecond - input.startSecond);
  const luma = await sampleLuma({
    sourcePath: input.sourcePath,
    startSecond: input.startSecond,
    endSecond: input.endSecond,
    workDir: input.workDir,
  });

  const windows = Math.min(6, Math.max(2, Math.round(duration / 5)));
  const samples = estimateSubjectOverTime(luma, windows);

  // One real frame per window, so the measurement can be checked against what
  // was actually on screen.
  const timestamps = samples.map((sample) => input.startSecond + sample.at * duration);
  const frames = await extractFrames(input.sourcePath, timestamps, input.workDir);

  return samples.map((sample, index) => ({
    second: timestamps[index]!,
    localSecond: sample.at * duration,
    framePath: frames[index]?.path ?? "",
    ...(sample.estimate
      ? { xCenter: sample.estimate.xCenter, confidence: sample.estimate.confidence }
      : {}),
  }));
}

/* ------------------------------- sampling ------------------------------- */

/**
 * Evenly spaced samples, pulled in from the very edges so we never land on a
 * cut-to-black at the clip boundary.
 */
function sampleTimestamps(startSecond: number, duration: number): number[] {
  const count = Math.min(MAX_SAMPLES, Math.max(MIN_SAMPLES, Math.round(duration / 5)));
  const inset = Math.min(1, duration * 0.08);
  const from = startSecond + inset;
  const span = Math.max(0.1, duration - inset * 2);
  return Array.from({ length: count }, (_, i) => from + (span * i) / Math.max(1, count - 1));
}

interface SampledFrame {
  readonly second: number;
  readonly jpegBase64: string;
  /** Kept so the diagnostic can show the frame the model was given. */
  readonly path: string;
}

/**
 * Pull single frames with input-side seeking (-ss before -i), which jumps
 * straight to the keyframe instead of decoding from zero. Downscaled to 512px,
 * which is plenty for a human checking where the detector pointed.
 */
async function extractFrames(
  sourcePath: string,
  timestamps: readonly number[],
  dir: string,
): Promise<SampledFrame[]> {
  await mkdir(dir, { recursive: true });
  const results = await Promise.all(
    timestamps.map(async (second, index) => {
      const path = join(dir, `frame-${index}.jpg`);
      try {
        await execFileAsync(
          await resolveMediaTool("ffmpeg"),
          [
            "-hide_banner", "-loglevel", "error", "-y",
            "-ss", String(second),
            "-i", sourcePath,
            "-frames:v", "1",
            "-vf", "scale=512:-2",
            "-q:v", "6",
            path,
          ],
          { timeout: 60_000 },
        );
        const buffer = await readFile(path);
        return { second, jpegBase64: buffer.toString("base64"), path };
      } catch {
        return undefined;
      }
    }),
  );
  return results.filter((frame): frame is SampledFrame => frame !== undefined);
}

/* ------------------------------- smoothing ------------------------------- */

/**
 * Three-point moving average. Raw per-frame estimates jitter by a few percent
 * even when the subject is still; panning on that jitter would look like camera
 * shake. Endpoints are kept as-is so the clip starts and ends framed correctly.
 */
export function smooth(keyframes: readonly ReframeKeyframe[]): ReframeKeyframe[] {
  if (keyframes.length <= 2) return [...keyframes];
  const sorted = [...keyframes].sort((a, b) => a.second - b.second);
  return sorted.map((keyframe, index) => {
    if (index === 0 || index === sorted.length - 1) return keyframe;
    const average =
      (sorted[index - 1]!.xCenter + keyframe.xCenter + sorted[index + 1]!.xCenter) / 3;
    return { second: keyframe.second, xCenter: average };
  });
}

function spread(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return Math.max(...values) - Math.min(...values);
}

/* ------------------------------- geometry ------------------------------- */

/**
 * Build the ffmpeg `crop` x-expression for a plan. Returns a plain number string
 * for a static crop and a piecewise-linear expression in `t` for a tracking one.
 *
 * Note on time: the render seeks with `-ss` BEFORE `-i`, so filter time `t`
 * starts at 0 at the clip's first frame — which is the same timeline the
 * keyframes use.
 */
export function cropXExpression(
  keyframes: readonly ReframeKeyframe[],
  sourceWidth: number,
  cropWidth: number,
): string {
  const maxX = Math.max(0, sourceWidth - cropWidth);
  const toX = (xCenter: number): number =>
    Math.round(Math.min(Math.max(xCenter * sourceWidth - cropWidth / 2, 0), maxX));

  if (keyframes.length === 0) return String(Math.round(maxX / 2));
  if (keyframes.length === 1) return String(toX(keyframes[0]!.xCenter));

  const points = [...keyframes].sort((a, b) => a.second - b.second);

  // Nested ifs form a piecewise-linear ramp between consecutive keyframes; the
  // final else holds the last value for the rest of the clip.
  let expression = String(toX(points.at(-1)!.xCenter));
  for (let i = points.length - 2; i >= 0; i--) {
    const from = points[i]!;
    const to = points[i + 1]!;
    const x0 = toX(from.xCenter);
    const x1 = toX(to.xCenter);
    const t0 = round2(from.second);
    const t1 = round2(to.second);
    const segment =
      t1 - t0 < 0.05
        ? String(x1)
        : `${x0}+(${x1 - x0})*(t-${t0})/${round2(t1 - t0)}`;
    expression = `if(lt(t,${t1}),${segment},${expression})`;
  }
  // Clamp: the ramp can overshoot slightly at the edges, and a crop window that
  // runs past the frame makes ffmpeg fail outright. Force even values too —
  // odd chroma offsets corrupt yuv420p output.
  return `trunc(min(max(${expression},0),${maxX})/2)*2`;
}

/**
 * Width of a crop window of the given aspect cut from a source of this height.
 * Defaults to 9:16 (a full-screen vertical crop); pass WIDE_CROP_ASPECT for the
 * gentler 4:5 window.
 */
export function cropWidthFor(sourceWidth: number, sourceHeight: number, aspect = 9 / 16): number {
  const ideal = Math.round(sourceHeight * aspect);
  // Never ask for more than exists; keep it even for yuv420p.
  return Math.max(2, Math.min(sourceWidth, ideal) - (Math.min(sourceWidth, ideal) % 2));
}

async function probeDimensions(path: string): Promise<{ width: number; height: number } | undefined> {
  const json = (await probeJson(path)) as
    | { streams?: { codec_type?: string; width?: number; height?: number }[] }
    | undefined;
  const video = json?.streams?.find((s) => s.codec_type === "video");
  if (!video?.width || !video?.height) return undefined;
  return { width: video.width, height: video.height };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
