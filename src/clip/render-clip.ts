import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { runFfmpeg, probeJson } from "../lib/media.js";
import type { TranscriptWord } from "./transcribe.js";
import { buildAss, toCaptionWords } from "./captions.js";
import type { CaptionPresetName, CaptionWord } from "./captions.js";
import { cropWidthFor, cropXExpression, FIT_PLAN, WIDE_CROP_ASPECT } from "./reframe.js";
import type { ReframePlan } from "./reframe.js";
import { planTighten, remapWords, selectExpression } from "./tighten.js";
import type { TightenPlan } from "./tighten.js";

/**
 * CLIP RENDERING — one source range becomes one finished 1080x1920 vertical clip.
 *
 * The filter chain is built in a fixed order, and the order matters:
 *
 *   1. REFRAME to 9:16. A tracking crop reads the filter clock `t`, so it has to
 *      run before anything that rewrites timestamps.
 *   2. TIGHTEN (optional) — drop the dead air with `select`, then renumber the
 *      frames with `setpts`. Audio gets the matching `aselect`/`asetpts`.
 *   3. CAPTIONS, burned last so they are never cropped, blurred or re-timed.
 *
 * Audio is loudness-normalised to -14 LUFS, which is what the platforms target.
 * Clips cut from different parts of a video otherwise arrive at wildly different
 * volumes, which is the most common "amateur" tell in a feed.
 */

const WIDTH = 1080;
const HEIGHT = 1920;
/** Where the video sits in the "fit-top" layout, as a fraction of frame height. */
const FIT_TOP_OFFSET = 0.17;
/**
 * "crop-wide": a 4:5 window scaled to the full output width, which makes it
 * 1350px tall — 70% of the frame, versus 31.6% for a whole 16:9 frame. Parked
 * near the top so its bottom edge clears the caption band.
 */
const WIDE_HEIGHT = Math.round((WIDTH * 5) / 4);
const WIDE_OFFSET = 0.05;
/** Platform loudness target. */
const LOUDNORM = "loudnorm=I=-14:TP=-1.5:LRA=11";
/**
 * x264 quality. 19 is visually transparent for this kind of material; lower is
 * better and bigger. Override with CLIP_CRF when archiving masters.
 */
const CRF = String(Number(process.env.CLIP_CRF ?? 19));
/**
 * Lanczos for the visible picture. A 1920-wide source has to come down to 1080
 * for a vertical frame, and ffmpeg's default bicubic softens that downscale
 * noticeably. The blurred background is about to be blurred anyway, so it keeps
 * the cheaper default.
 */
const SHARP = "flags=lanczos";

export interface RenderClipInput {
  readonly sourcePath: string;
  readonly startSecond: number;
  readonly endSecond: number;
  readonly words: readonly TranscriptWord[];
  readonly outPath: string;
  readonly assPath: string;
  readonly reframe?: ReframePlan;
  readonly captionPreset?: CaptionPresetName;
  /** Burned across the top for the first couple of seconds. */
  readonly hook?: string;
  /** Remove dead air and fillers. Callers disable this for action clips. */
  readonly tighten?: boolean;
}

export interface RenderResult {
  readonly ok: boolean;
  readonly stderr: string;
  /** Final clip length after any tightening. */
  readonly durationSeconds: number;
  /** What was applied, for logs. */
  readonly note: string;
}

export async function renderClip(input: RenderClipInput): Promise<RenderResult> {
  await mkdir(dirname(input.outPath), { recursive: true });
  const sourceDuration = Math.max(1, input.endSecond - input.startSecond);
  const reframe = input.reframe ?? FIT_PLAN;
  const preset = input.captionPreset ?? "bold-yellow";

  // Words on the clip's own timeline.
  const localWords = toCaptionWords(input.words, input.startSecond, input.endSecond);

  // Tightening decides the final duration, so it must be planned before captions
  // are written — the captions are then remapped onto the shortened timeline.
  const tighten: TightenPlan = input.tighten
    ? planTighten(localWords, sourceDuration)
    : {
        ranges: [{ start: 0, end: sourceDuration }],
        removedSeconds: 0,
        applied: false,
        durationSeconds: sourceDuration,
        note: "tightening disabled",
      };

  const finalDuration = tighten.applied ? tighten.durationSeconds : sourceDuration;
  const captionWords: CaptionWord[] = tighten.applied ? remapWords(tighten, localWords) : localWords;

  await writeFile(
    input.assPath,
    buildAss({
      words: captionWords,
      width: WIDTH,
      height: HEIGHT,
      preset,
      hook: input.hook,
      durationSeconds: finalDuration,
    }),
    "utf8",
  );

  // Some sources genuinely have no audio track (silent screen recordings, a few
  // highlight rips). ffmpeg fails outright on a missing [0:a], so those get a
  // generated silent track instead — which also keeps the output valid for the
  // platforms, all of which expect an audio stream.
  const hasAudio = await hasAudioStream(input.sourcePath);

  const filter = buildFilterGraph({
    reframe,
    tighten,
    assPath: input.assPath,
    hasCaptions: captionWords.length > 0 || Boolean(input.hook),
    hasAudio,
  });

  const result = await runFfmpeg([
    "-y",
    // -ss and -t BOTH bind to the input that follows them. Writing the trim this
    // way is not a style choice: a trailing `-t` placed before the output only
    // behaves as an output option while this is the LAST input, so adding the
    // silent track below silently re-bound it and stopped trimming the video.
    "-ss", String(input.startSecond),
    "-t", String(sourceDuration),
    "-i", input.sourcePath,
    // Silence is generated at exactly the FINAL length, so it needs no trimming
    // of its own and cannot run past the video.
    ...(hasAudio
      ? []
      : ["-f", "lavfi", "-t", String(finalDuration), "-i", "anullsrc=channel_layout=stereo:sample_rate=48000"]),
    "-filter_complex", filter,
    "-map", "[v]",
    "-map", "[a]",
    "-c:v", "libx264", "-preset", "fast", "-crf", CRF, "-pix_fmt", "yuv420p",
    "-r", "30",
    "-threads", "2",
    "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
    "-movflags", "+faststart",
    input.outPath,
  ]);

  const notes = [reframe.note, tighten.applied ? tighten.note : undefined, `${preset} captions`]
    .filter((note): note is string => Boolean(note))
    .join(" · ");

  return { ok: result.ok, stderr: result.stderr, durationSeconds: finalDuration, note: notes };
}

/* ----------------------------- filter graph ----------------------------- */

interface FilterInput {
  readonly reframe: ReframePlan;
  readonly tighten: TightenPlan;
  readonly assPath: string;
  readonly hasCaptions: boolean;
  readonly hasAudio: boolean;
}

function buildFilterGraph(input: FilterInput): string {
  const chains: string[] = [];

  /* --- 1. reframe to 9:16 --- */
  chains.push(...reframeChain(input.reframe));
  let videoLabel = "[reframed]";

  /* --- 2. tighten (video + audio) --- */
  if (input.tighten.applied) {
    const expression = selectExpression(input.tighten);
    chains.push(`${videoLabel}select='${expression}',setpts=N/FRAME_RATE/TB[tight]`);
    videoLabel = "[tight]";
    if (input.hasAudio) {
      // The audio must be cut with the SAME ranges or it drifts out of sync.
      chains.push(`[0:a]aselect='${expression}',asetpts=N/SR/TB,${LOUDNORM}[a]`);
    }
  } else if (input.hasAudio) {
    chains.push(`[0:a]${LOUDNORM}[a]`);
  }

  // Generated silence is already the right length, and normalising silence is
  // meaningless, so it is passed straight through.
  if (!input.hasAudio) chains.push("[1:a]anull[a]");

  /* --- 3. captions, burned last --- */
  if (input.hasCaptions) {
    // ffmpeg parses ':' as an option separator inside a filter, so a Windows
    // drive letter or any colon in the path has to be escaped.
    const subtitlePath = input.assPath.replace(/\\/gu, "/").replace(/:/gu, "\\:");
    chains.push(`${videoLabel}subtitles='${subtitlePath}'[v]`);
  } else {
    chains.push(`${videoLabel}null[v]`);
  }

  return chains.join(";");
}

/** Whether the file has an audio stream at all. Unprobeable files are assumed silent. */
async function hasAudioStream(path: string): Promise<boolean> {
  const json = (await probeJson(path)) as { streams?: { codec_type?: string }[] } | undefined;
  if (!json?.streams) return false;
  return json.streams.some((stream) => stream.codec_type === "audio");
}

function reframeChain(plan: ReframePlan): string[] {
  // The resampler flag belongs to `scale`; this chain ENDS in `crop`, so it
  // cannot be appended by the caller — crop has no `flags` option and ffmpeg
  // rejects the whole graph.
  const fill =
    `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase:${SHARP},` +
    `crop=${WIDTH}:${HEIGHT}`;

  switch (plan.kind) {
    /**
     * Subject-tracked crop: cut a 9:16 window out of the source, following the
     * subject, then scale it to the output size. The trailing fill is a safety
     * net — if the source is narrower than a true 9:16 window the crop cannot be
     * exact, and this makes up the difference instead of stretching the picture.
     */
    case "crop": {
      if (!plan.sourceWidth || !plan.sourceHeight) return fitChain(false);
      const cropWidth = cropWidthFor(plan.sourceWidth, plan.sourceHeight);
      const xExpression = cropXExpression(plan.keyframes, plan.sourceWidth, cropWidth);
      return [
        `[0:v]crop=w=${cropWidth}:h=${plan.sourceHeight}:x='${xExpression}':y=0,` +
          `${fill},setsar=1[reframed]`,
      ];
    }

    /**
     * A gentler crop: keeps more of the scene than a full 9:16 window while
     * still filling most of the frame, with a blurred fill behind the bands.
     * The middle option between "everything is tiny" and "the sides are gone".
     */
    case "crop-wide": {
      if (!plan.sourceWidth || !plan.sourceHeight) return fitChain(false);
      const cropWidth = cropWidthFor(plan.sourceWidth, plan.sourceHeight, WIDE_CROP_ASPECT);
      const xExpression = cropXExpression(plan.keyframes, plan.sourceWidth, cropWidth);
      const y = Math.round(HEIGHT * WIDE_OFFSET);
      return [
        `[0:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase:${SHARP},` +
          `crop=${WIDTH}:${HEIGHT},boxblur=40:2,setsar=1[bg]`,
        `[0:v]crop=w=${cropWidth}:h=${plan.sourceHeight}:x='${xExpression}':y=0,` +
          `scale=${WIDTH}:${WIDE_HEIGHT}:${SHARP},setsar=1[fg]`,
        `[bg][fg]overlay=(W-w)/2:${y}[reframed]`,
      ];
    }

    /** Source is already vertical — scale it, don't invent a layout. */
    case "passthrough":
      return [`[0:v]${fill},setsar=1[reframed]`];

    /** Wide action: whole frame kept, parked high, blurred fill behind. */
    case "fit-top":
      return fitChain(true);

    case "fit":
    default:
      return fitChain(false);
  }
}

/**
 * Whole-frame layout over a blurred copy of itself. THE DEFAULT, and the one
 * that leaves the original picture untouched: every pixel of the source frame
 * survives, in the original aspect ratio, with no cropping and no stretching.
 *
 * The blur applies ONLY to the background copy that fills the empty bars. The
 * picture overlaid on top of it is a separate, unblurred branch of the graph —
 * the two never mix.
 */
function fitChain(top: boolean): string[] {
  const y = top ? `${Math.round(HEIGHT * FIT_TOP_OFFSET)}` : "(H-h)/2";
  return [
    // Background: deliberately cheap — it is about to be blurred to mush.
    `[0:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,` +
      `crop=${WIDTH}:${HEIGHT},boxblur=40:2,setsar=1[bg]`,
    // Foreground: the real picture. `decrease` fits it inside the canvas whole,
    // so the aspect ratio is preserved exactly and nothing is cut.
    `[0:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease:${SHARP},setsar=1[fg]`,
    `[bg][fg]overlay=(W-w)/2:${y}[reframed]`,
  ];
}
