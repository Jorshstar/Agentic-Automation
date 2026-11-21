import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";
import { resolveMediaTool } from "../lib/binaries.js";
import { uploadLimitBytes } from "../telegram/telegram-client.js";

const execFileAsync = promisify(execFile);

/**
 * COMPILATION — join the selected moments into ONE video.
 *
 * Why this exists: "clip the goals" is a request for the goals, singular as a
 * thing to watch. Handing back five separate files makes the viewer open five
 * files to see one night's football, and that is not what was asked for. One
 * request for one subject should produce one video; separate files are for
 * separate requests.
 *
 * Re-encoding rather than stream-copying is deliberate. The clips were each
 * encoded independently, so a copy-concat inherits whatever timestamp and
 * keyframe mismatch sits at every join — audio drift and a frozen frame at the
 * seam. These are a handful of short clips off one source, so a re-encode costs
 * seconds and removes the whole class of problem.
 *
 * Dimensions are NOT changed. Every clip came from one source through one
 * reframe plan, so they already match; the filter normalises only the sample
 * aspect ratio and frame rate, which is what actually breaks a concat.
 */

export interface CompileResult {
  readonly ok: boolean;
  readonly path: string;
  readonly durationSeconds: number;
  readonly error?: string;
}

/** 30 fps at the join: a mixed-rate concat stutters at every seam. */
const OUTPUT_FPS = 30;
const CRF = process.env.CLIP_CRF ?? "20";
const AUDIO_KBPS = 160;

/**
 * THE JOINED FILE HAS TO FIT THROUGH TELEGRAM.
 *
 * The first joined reel was 66 MB: four goals, 62 seconds, 1080p at CRF 20 —
 * about 8.5 Mbps, nearly three times the bitrate of the source it was cut from.
 * The Bot API refuses a video over 50 MB, so the delivery sent the caption and
 * no video, and the chat said "couldn't produce clips" about four clips that
 * had rendered perfectly.
 *
 * Separate clips never hit this because each one was 14-21 MB on its own. The
 * moment they became one file, the sum was the problem.
 *
 * So the join is encoded to a BYTE BUDGET rather than to a quality target: work
 * out how many bits per second fit in the budget, and cap the encoder there.
 * Quality-capped VBR (CRF plus a hard maxrate) keeps the easy seconds cheap and
 * only spends the cap on the hard ones.
 */
/**
 * Headroom for container overhead and the encoder overshooting its cap.
 *
 * Quality-capped VBR treats maxrate as a ceiling on the rate window, not a
 * promise about the file, and on hard content (football is hard — grass,
 * crowd, constant motion) it rides that ceiling. Measured overshoot on the
 * first real reel was 1.3%; this leaves far more room than that, because a
 * file one megabyte over the limit is as undeliverable as one twenty over.
 */
const BUDGET_FRACTION = 0.85;

/**
 * The limit comes from the delivery layer, not from a copy of it here. A local
 * telegram-bot-api server raises it to 2 GB, at which point the reel is nowhere
 * near it and there is no reason to spend quality on a budget that has stopped
 * applying — hence the cutoff rather than a cap that is always on.
 */
function budgetBytes(): number {
  const limit = uploadLimitBytes();
  return limit > 500 * 1024 * 1024 ? Number.POSITIVE_INFINITY : limit * BUDGET_FRACTION;
}

/**
 * Video bitrate that fits `seconds` of footage into `bytes`, or undefined when
 * there is no meaningful limit. Floored at 800 kbps: below that the reel is too
 * ugly to be worth sending, and the caller is better off with separate clips.
 */
export function bitrateForBudget(seconds: number, bytes: number): number | undefined {
  if (!Number.isFinite(bytes) || seconds <= 0) return undefined;
  const totalKbps = (bytes * 8) / 1000 / seconds;
  return Math.max(800, Math.floor(totalKbps - AUDIO_KBPS));
}

export async function compileClips(
  paths: readonly string[],
  outPath: string,
): Promise<CompileResult> {
  if (paths.length === 0) return { ok: false, path: "", durationSeconds: 0, error: "nothing to join" };
  if (paths.length === 1) {
    // One moment is already the video. Re-encoding it would only lose quality.
    return { ok: true, path: paths[0]!, durationSeconds: await probeDuration(paths[0]!) };
  }

  const ffmpeg = await resolveMediaTool("ffmpeg");
  const inputs = paths.flatMap((path) => ["-i", path]);

  // Measured, not assumed: the clips were trimmed and may not match what was
  // asked for, and a wrong duration here produces a wrong bitrate.
  const durations = await Promise.all(paths.map((path) => probeDuration(path)));
  const totalSeconds = durations.reduce((sum, seconds) => sum + seconds, 0);
  const videoKbps = bitrateForBudget(totalSeconds, budgetBytes());
  const rateControl =
    videoKbps === undefined
      ? ["-crf", CRF]
      : [
          "-crf",
          CRF,
          "-maxrate",
          `${videoKbps}k`,
          "-bufsize",
          `${videoKbps * 2}k`,
        ];

  // Normalise each stream, then concat. `setsar=1` and a fixed fps are the two
  // things that actually differ enough to corrupt a join.
  const prepared = paths
    .map(
      (_, index) =>
        `[${index}:v]setsar=1,fps=${OUTPUT_FPS},format=yuv420p[v${index}];` +
        `[${index}:a]aresample=48000,aformat=channel_layouts=stereo[a${index}]`,
    )
    .join(";");
  const joinInputs = paths.map((_, index) => `[v${index}][a${index}]`).join("");
  const filter = `${prepared};${joinInputs}concat=n=${paths.length}:v=1:a=1[v][a]`;

  try {
    await execFileAsync(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        ...inputs,
        "-filter_complex",
        filter,
        "-map",
        "[v]",
        "-map",
        "[a]",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        ...rateControl,
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-ar",
        "48000",
        outPath,
      ],
      { maxBuffer: 1024 * 1024 * 64, timeout: 30 * 60_000 },
    );
  } catch (error) {
    return {
      ok: false,
      path: "",
      durationSeconds: 0,
      error: (error instanceof Error ? error.message : String(error)).slice(0, 200),
    };
  }

  const durationSeconds = await probeDuration(outPath);
  if (durationSeconds <= 0) {
    return { ok: false, path: "", durationSeconds: 0, error: "joined file has no duration" };
  }

  // The cap is a cap on the encoder, not a guarantee about the file. Check what
  // actually came out, because a file that cannot be sent is worth less than
  // the separate clips the caller still has.
  const limit = budgetBytes();
  if (Number.isFinite(limit)) {
    const size = await fileBytes(outPath);
    if (size > uploadLimitBytes()) {
      const limitMb = Math.round(uploadLimitBytes() / 1024 / 1024);
      return {
        ok: false,
        path: "",
        durationSeconds,
        error: `joined file is ${(size / 1024 / 1024).toFixed(1)} MB, over the ${limitMb} MB upload limit`,
      };
    }
  }
  return { ok: true, path: outPath, durationSeconds };
}

async function fileBytes(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

async function probeDuration(path: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync(await resolveMediaTool("ffprobe"), [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=nw=1:nk=1",
      path,
    ]);
    const seconds = Number.parseFloat(stdout.trim());
    return Number.isFinite(seconds) ? seconds : 0;
  } catch {
    return 0;
  }
}

/**
 * Does the user want the moments as ONE video, or as separate files?
 *
 * `undefined` means they did not say, and the caller falls back to what suits
 * the content: a run of 15-second goals is a reel, five 40-second stories are
 * five clips.
 */
export function wantsCompilation(text: string): boolean | undefined {
  if (
    /\b(separate\w*|individual\w*|one by one|one at a time|split (them )?(up|out)|apart)\b/iu.test(
      text,
    )
  ) {
    return false;
  }
  if (
    /\b(compil|montage|reel|highlight ?reel|one video|single video|1 video|all in one|together|combine|joined?|stitch|merge|as one)\w*\b/iu.test(
      text,
    )
  ) {
    return true;
  }
  return undefined;
}
