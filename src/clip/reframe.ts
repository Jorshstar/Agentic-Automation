import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveMediaTool } from "../lib/binaries.js";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { probeJson } from "../lib/media.js";
import type { ThemePlan } from "./themes.js";

const execFileAsync = promisify(execFile);

/**
 * REFRAMING — turning a 16:9 source into a 9:16 vertical clip.
 *
 * The DEFAULT keeps the original picture completely intact: the full frame is
 * placed on the vertical canvas over a blurred copy of itself. Nothing is
 * cropped, stretched or repainted, and no AI model sees a pixel of the output.
 *
 * Subject-tracked cropping is available but opt-in, because it fills the screen
 * by discarding the sides of the frame. When it is on, we avoid a face-detection
 * dependency by sampling a handful of frames and asking a vision model where the
 * subject is — it returns a COORDINATE, not an image. ffmpeg does the cropping.
 * That costs about $0.0002 per clip on gpt-4o-mini at low detail.
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

export type ReframeKind = "crop" | "crop-wide" | "fit-top" | "fit" | "passthrough";

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
  /** Human-readable note for logs ("vision: 6/6 frames, static crop"). */
  readonly note: string;
}

export const FIT_PLAN: ReframePlan = { kind: "fit", keyframes: [], note: "blurred fit (default)" };

/** Max frames we ever send to the vision model for one clip. */
const MAX_SAMPLES = 7;
const MIN_SAMPLES = 3;
/** Below this confidence a frame's answer is discarded. */
const MIN_CONFIDENCE = 0.45;
/**
 * If the subject moves less than this fraction of frame width across the whole
 * clip, hold the crop still. A crop that drifts a few pixels looks like a
 * wobble, which is worse than no movement at all.
 */
const STATIC_DEVIATION = 0.05;
/** Vision model: cheapest one that reliably localises a subject in a frame. */
const VISION_MODEL = "gpt-4o-mini";

export type ReframeMode = "smart" | "wide" | "fit" | "fit-top";

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
 * redraws, upscales or "enhances" any frame. The vision pass only READS a few
 * sampled frames and returns a number — where the subject is. Every pixel
 * operation is plain ffmpeg.
 */
export function defaultModeForTheme(plan: ThemePlan): ReframeMode {
  const override = parseLayoutInstruction(process.env.CLIP_REFRAME ?? "");
  if (override) return override;
  // Wide action genuinely needs the whole frame — a 9:16 crop of a football
  // pitch throws away the play. Everything else defaults to the full-screen
  // tracked crop, because that is what short-form actually looks like.
  return plan.family === "sports-action" ? "fit-top" : "smart";
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
  if (value === "smart" || value === "crop" || value === "zoom") return "smart";
  if (value === "wide" || value === "balanced") return "wide";
  if (value === "fit" || value === "whole" || value === "full-frame") return "fit";
  if (value === "fit-top" || value === "top") return "fit-top";

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
    /\b(full ?screen|fill (the )?(screen|frame)|like ?tik ?tok|tiktok style|zoom(ed)? in|close ?up|crop(ped)?( in)?|no bars|no blur|fill it)\b/u.test(
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

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { ...FIT_PLAN, sourceWidth, sourceHeight, note: "no OPENAI_API_KEY — blurred fit" };
  }
  if (!sourceWidth || !sourceHeight) {
    return { ...FIT_PLAN, note: "could not probe source size — blurred fit" };
  }

  const duration = Math.max(1, input.endSecond - input.startSecond);
  const sampleDir = join(input.workDir, "reframe");
  try {
    const timestamps = sampleTimestamps(input.startSecond, duration);
    const frames = await extractFrames(input.sourcePath, timestamps, sampleDir);
    if (frames.length < MIN_SAMPLES) {
      return { ...FIT_PLAN, sourceWidth, sourceHeight, note: "frame sampling failed — blurred fit" };
    }

    const located = await locateSubjects(apiKey, frames.map((f) => f.jpegBase64));
    const usable = located
      .map((result, index) => ({ result, second: timestamps[index]! - input.startSecond }))
      .filter((entry) => entry.result !== undefined && entry.result.confidence >= MIN_CONFIDENCE);

    if (usable.length < MIN_SAMPLES) {
      return {
        ...FIT_PLAN,
        sourceWidth,
        sourceHeight,
        note: `vision unsure (${usable.length}/${frames.length}) — blurred fit`,
      };
    }

    const raw = usable.map((entry) => ({ second: entry.second, xCenter: entry.result!.x }));
    const smoothed = smooth(raw);
    const deviation = spread(smoothed.map((k) => k.xCenter));

    const kind: ReframeKind = input.mode === "wide" ? "crop-wide" : "crop";

    if (deviation < STATIC_DEVIATION) {
      const mean = smoothed.reduce((sum, k) => sum + k.xCenter, 0) / smoothed.length;
      return {
        kind,
        sourceWidth,
        sourceHeight,
        keyframes: [{ second: 0, xCenter: mean }],
        note: `vision ${usable.length}/${frames.length}, static crop @ ${mean.toFixed(2)}`,
      };
    }

    return {
      kind,
      sourceWidth,
      sourceHeight,
      keyframes: smoothed,
      note: `vision ${usable.length}/${frames.length}, tracking crop (${smoothed.length} keyframes)`,
    };
  } catch {
    return { ...FIT_PLAN, sourceWidth, sourceHeight, note: "reframe failed — blurred fit" };
  } finally {
    await rm(sampleDir, { recursive: true, force: true }).catch(() => undefined);
  }
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
}

/**
 * Pull single frames with input-side seeking (-ss before -i), which jumps
 * straight to the keyframe instead of decoding from zero. Downscaled to 512px:
 * the vision model runs at low detail anyway, so anything larger is wasted
 * bandwidth and tokens.
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
        return { second, jpegBase64: buffer.toString("base64") };
      } catch {
        return undefined;
      }
    }),
  );
  return results.filter((frame): frame is SampledFrame => frame !== undefined);
}

/* -------------------------------- vision -------------------------------- */

interface SubjectLocation {
  readonly x: number;
  readonly confidence: number;
}

const VISION_INSTRUCTION =
  "Each image is one frame from a video, in order. For EACH frame, report the horizontal centre " +
  "of the MAIN SUBJECT a viewer's eye goes to — the person speaking, the face, or the focus of " +
  "the action. Use a 0..1 scale where 0 is the left edge and 1 is the right edge of the frame. " +
  "If several people are present, choose the one who is speaking or most prominent. If the frame " +
  "is a title card, a blank, or has no clear subject, give your best guess with low confidence. " +
  'Reply with ONLY this JSON: {"frames":[{"i":0,"x":0.5,"confidence":0.0}]} — one entry per frame, ' +
  "in the same order, i starting at 0. confidence is 0..1.";

/**
 * One request carrying every frame, so we pay a single prompt overhead rather
 * than one per frame. `detail: "low"` fixes each image at 85 tokens.
 */
async function locateSubjects(apiKey: string, framesBase64: readonly string[]): Promise<(SubjectLocation | undefined)[]> {
  const content: unknown[] = [{ type: "text", text: VISION_INSTRUCTION }];
  for (const base64 of framesBase64) {
    content.push({
      type: "image_url",
      image_url: { url: `data:image/jpeg;base64,${base64}`, detail: "low" },
    });
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: [{ role: "user", content }],
      response_format: { type: "json_object" },
      max_tokens: 400,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) return framesBase64.map(() => undefined);

  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = payload.choices?.[0]?.message?.content;
  if (!text) return framesBase64.map(() => undefined);

  let parsed: { frames?: { i?: number; x?: number; confidence?: number }[] };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    return framesBase64.map(() => undefined);
  }

  const byIndex: (SubjectLocation | undefined)[] = framesBase64.map(() => undefined);
  for (const [position, entry] of (parsed.frames ?? []).entries()) {
    const index = typeof entry.i === "number" ? entry.i : position;
    const x = entry.x;
    const confidence = entry.confidence;
    if (
      index >= 0 &&
      index < byIndex.length &&
      typeof x === "number" &&
      Number.isFinite(x) &&
      x >= 0 &&
      x <= 1
    ) {
      byIndex[index] = {
        x,
        confidence: typeof confidence === "number" && Number.isFinite(confidence) ? confidence : 0.5,
      };
    }
  }
  return byIndex;
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
