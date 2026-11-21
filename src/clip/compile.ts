import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveMediaTool } from "../lib/binaries.js";

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
        "-crf",
        CRF,
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
  return { ok: true, path: outPath, durationSeconds };
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
