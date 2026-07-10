import { mkdir, writeFile, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { runFfmpeg, probeDurationSeconds } from "../../lib/media.js";
import type { GeneratedImage } from "../image-generation/index.js";
import type { CompositionProvider } from "./composition-provider.js";
import type {
  CompositionContext,
  CompositionRequest,
  GeneratedVideo,
  CompositionWarning,
  CompositionMetadata,
} from "./types.js";

/**
 * FfmpegCompositionProvider — renders the final MP4 with FFmpeg.
 *
 * Staged for reliability (each ffmpeg call is simple and debuggable):
 *   1. one image clip per segment (scale-crop to fill + a gentle Ken-Burns pan),
 *   2. concatenate the clips into the silent visual track,
 *   3. concatenate the per-segment voice into one narration track,
 *   4. final pass: burn captions, duck music under the voice, encode.
 *
 * Defensive throughout: a missing image → colour card; a failed clip → warning;
 * if the caption burn fails, it retries once WITHOUT captions so you still get a
 * video. It is the ONLY stage that touches FFmpeg composition.
 */

const DEFAULT_COMPOSITION_CONTEXT: CompositionContext = {
  width: 1080,
  height: 1920,
  fps: 30,
  outputPath: "output/video/video.mp4",
  workDir: "output/video/work",
  musicVolume: 0.15,
  kenBurns: true,
};

export class FfmpegCompositionProvider implements CompositionProvider {
  readonly name = "ffmpeg-composition-provider";

  private lastResult: GeneratedVideo | undefined;

  constructor(private readonly context: CompositionContext = DEFAULT_COMPOSITION_CONTEXT) {}

  get last(): GeneratedVideo | undefined {
    return this.lastResult;
  }

  async compose(request: CompositionRequest): Promise<GeneratedVideo> {
    const ctx: CompositionContext = { ...this.context, ...request.context };
    const warnings: CompositionWarning[] = [];
    const startedAt = Date.now();

    await mkdir(ctx.workDir, { recursive: true });
    await mkdir(dirname(ctx.outputPath), { recursive: true });

    const imagesById = new Map<string, GeneratedImage>(
      request.images.images
        // Keep any scene with a usable visual — a real image OR a stock video clip.
        .filter((image) => image.status === "generated" && (image.imagePath !== "" || (image.videoPath ?? "") !== ""))
        .map((image) => [image.segmentId, image]),
    );

    // --- 1 + 3 spine: only segments that actually have narration audio ---
    const clipNames: string[] = [];
    const voiceInputs: string[] = [];
    let clipIndex = 0;
    let totalSeconds = 0;

    for (const segment of request.voiceover.segments) {
      if (segment.audioPath === "") {
        warnings.push({ code: "missing-audio", message: "Segment has no audio; skipped.", segmentId: segment.segmentId });
        continue;
      }

      const duration = Math.max(0.4, round3(segment.actualDurationSeconds));
      const clipName = `clip-${clipIndex}.mp4`;
      const clipPath = join(ctx.workDir, clipName);
      const image = imagesById.get(segment.segmentId);

      if (!image) {
        warnings.push({ code: "missing-image", message: "No image; using a colour card.", segmentId: segment.segmentId });
      }

      // Fallback ladder: real stock CLIP → motion image clip → STATIC image clip
      // → colour card. Each step degrades gracefully, never straight to black.
      let rendered = false;
      if (image?.videoPath) {
        // Real footage: scale/crop to frame, loop if shorter than the scene, trim
        // to the narration duration, drop the clip's own audio.
        rendered = (await runFfmpeg(stockClipArgs(image.videoPath, duration, ctx, clipPath))).ok;
        if (!rendered) {
          warnings.push({ code: "clip-failed", message: "Stock clip failed; falling back.", segmentId: segment.segmentId });
        }
      }
      if (!rendered && image && image.imagePath !== "") {
        rendered = (await runFfmpeg(imageClipArgs(image.imagePath, duration, clipIndex, ctx, clipPath))).ok;
        if (!rendered) {
          rendered = (await runFfmpeg(staticImageClipArgs(image.imagePath, duration, ctx, clipPath))).ok;
          if (rendered) {
            warnings.push({ code: "clip-failed", message: "Motion clip failed; used the static image.", segmentId: segment.segmentId });
          }
        }
      }
      if (!rendered) {
        const fallback = await runFfmpeg(colorClipArgs(duration, ctx, clipPath));
        if (!fallback.ok) {
          warnings.push({ code: "clip-failed", message: `Clip render failed entirely: ${fallback.stderr}`, segmentId: segment.segmentId });
          continue;
        }
        if (image) {
          warnings.push({ code: "clip-failed", message: "Image clip failed; used colour card.", segmentId: segment.segmentId });
        }
      }

      clipNames.push(clipName);
      voiceInputs.push(segment.audioPath);
      totalSeconds += duration;
      clipIndex += 1;
    }

    if (clipNames.length === 0) {
      return this.fail(ctx, warnings, startedAt, request.voiceover.segments.length, "No renderable segments.");
    }

    // --- 2: clips concat list (paths relative to the list's own directory) ---
    const listPath = join(ctx.workDir, "clips.txt");
    await writeFile(listPath, clipNames.map((name) => `file '${name}'`).join("\n") + "\n", "utf8");

    // --- 3: concatenate the voice into one track ---
    const voicePath = join(ctx.workDir, "voice.wav");
    const voiceRun = await runFfmpeg(voiceConcatArgs(voiceInputs, voicePath));
    const hasAudio = voiceRun.ok;
    if (!hasAudio) {
      warnings.push({ code: "voice-concat-failed", message: `Voice concat failed: ${voiceRun.stderr}` });
    }

    // --- 4: final render (burn captions, duck music, encode) ---
    const totalStr = round3(totalSeconds).toString();
    const musicPath = request.music && request.music.musicPath !== "" ? request.music.musicPath : undefined;
    const captionsPath =
      request.captions && request.captions.assPath !== ""
        ? request.captions.assPath.replace(/\\/gu, "/")
        : undefined;

    let usedCaptions = Boolean(captionsPath);
    let render = await runFfmpeg(
      finalArgs({ listPath, voicePath: hasAudio ? voicePath : undefined, musicPath, captionsPath, ctx, totalStr }),
    );

    // If the caption burn failed, retry once without captions.
    if (!render.ok && usedCaptions) {
      warnings.push({ code: "captions-skipped", message: `Caption burn failed; retrying without: ${render.stderr}` });
      usedCaptions = false;
      render = await runFfmpeg(
        finalArgs({ listPath, voicePath: hasAudio ? voicePath : undefined, musicPath, captionsPath: undefined, ctx, totalStr }),
      );
    }

    if (!render.ok) {
      return this.fail(ctx, [...warnings, { code: "render-failed", message: render.stderr }], startedAt, request.voiceover.segments.length, render.stderr);
    }

    const measured = await probeDurationSeconds(ctx.outputPath);
    if (measured === undefined) {
      warnings.push({ code: "probe-failed", message: "Could not measure the rendered video." });
    }
    const sizeBytes = await fileBytes(ctx.outputPath);

    const metadata: CompositionMetadata = {
      provider: this.name,
      segmentCount: request.voiceover.segments.length,
      clipCount: clipNames.length,
      renderMs: Date.now() - startedAt,
      sizeBytes,
    };

    const result: GeneratedVideo = {
      videoPath: ctx.outputPath,
      durationSeconds: measured ?? round3(totalSeconds),
      width: ctx.width,
      height: ctx.height,
      fps: ctx.fps,
      hasAudio,
      hasCaptions: usedCaptions,
      hasMusic: Boolean(musicPath),
      warnings,
      metadata,
    };
    this.lastResult = result;
    return result;
  }

  private fail(
    ctx: CompositionContext,
    warnings: readonly CompositionWarning[],
    startedAt: number,
    segmentCount: number,
    _reason: string,
  ): GeneratedVideo {
    const result: GeneratedVideo = {
      videoPath: "",
      durationSeconds: 0,
      width: ctx.width,
      height: ctx.height,
      fps: ctx.fps,
      hasAudio: false,
      hasCaptions: false,
      hasMusic: false,
      warnings,
      metadata: { provider: this.name, segmentCount, clipCount: 0, renderMs: Date.now() - startedAt, sizeBytes: 0 },
    };
    this.lastResult = result;
    return result;
  }
}

/* ------------------------------- ffmpeg args ------------------------------- */

/** The four Ken-Burns motion types, cycled per segment for variety. */
type MotionType = "zoom-in" | "pan-up" | "zoom-out" | "pan-down";
const MOTIONS: readonly MotionType[] = ["zoom-in", "pan-up", "zoom-out", "pan-down"];

/** Smoothstep easing expression for a 0..1 progress `p` (as an ffmpeg expr). */
function eased(p: string): string {
  return `(3*pow(${p},2)-2*pow(${p},3))`;
}

/**
 * One image clip with motion: zooms via zoompan (2x pre-scale to avoid jitter),
 * pans via an animated crop window — both with smoothstep easing so movement
 * starts and ends gently instead of the old linear glide.
 */
function imageClipArgs(
  imagePath: string,
  duration: number,
  index: number,
  ctx: CompositionContext,
  clipPath: string,
): string[] {
  if (!ctx.kenBurns) {
    return staticImageClipArgs(imagePath, duration, ctx, clipPath);
  }

  const durStr = duration.toString();
  const fps = ctx.fps;
  const motion = MOTIONS[index % MOTIONS.length] ?? "pan-up";

  const shared: readonly string[] = [
    "-an",
    "-r", String(fps),
    "-c:v", "libx264",
    "-preset", "veryfast",
    // Cap encoder threads — x264 otherwise reads the HOST core count (not the
    // container limit) and spawns dozens of threads, exhausting memory (OOM).
    "-threads", "2",
    "-pix_fmt", "yuv420p",
    "-t", durStr,
    clipPath,
  ];

  if (motion === "zoom-in" || motion === "zoom-out") {
    // zoompan needs ONE input frame; it generates `d` output frames itself.
    // Pre-scaling to 2x the target size keeps the sub-pixel zoom smooth.
    const frames = Math.max(2, Math.round(duration * fps));
    const denominator = Math.max(frames - 1, 1);
    const ease = eased(`on/${denominator}`);
    const zoomExpr = motion === "zoom-in" ? `1+0.14*${ease}` : `1.14-0.14*${ease}`;
    const vf =
      `scale=${ctx.width * 2}:${ctx.height * 2}:force_original_aspect_ratio=increase,` +
      `crop=${ctx.width * 2}:${ctx.height * 2},` +
      `zoompan=z='${zoomExpr}':d=${frames}:x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':` +
      `s=${ctx.width}x${ctx.height}:fps=${fps},format=yuv420p`;
    return ["-y", "-i", imagePath, "-vf", vf, "-frames:v", String(frames), ...shared];
  }

  // Pans: overscan 1.2x, then slide the crop window vertically with easing.
  const coverW = Math.round(ctx.width * 1.2);
  const coverH = Math.round(ctx.height * 1.2);
  const xSlack = Math.round((coverW - ctx.width) / 2);
  const ySlack = coverH - ctx.height;
  const ease = eased(`t/${durStr}`);
  const yExpr = motion === "pan-down" ? `${ySlack}*${ease}` : `${ySlack}*(1-${ease})`;
  const vf =
    `scale=${coverW}:${coverH}:force_original_aspect_ratio=increase,crop=${coverW}:${coverH},` +
    `crop=${ctx.width}:${ctx.height}:x=${xSlack}:y='${yExpr}',format=yuv420p,fps=${fps}`;

  return [
    "-y",
    "-loop", "1",
    "-framerate", String(fps),
    "-t", durStr,
    "-i", imagePath,
    "-vf", vf,
    ...shared,
  ];
}

/** A motionless image clip (scale-crop only) — the fallback when motion fails. */
function staticImageClipArgs(
  imagePath: string,
  duration: number,
  ctx: CompositionContext,
  clipPath: string,
): string[] {
  const durStr = duration.toString();
  return [
    "-y",
    "-loop", "1",
    "-framerate", String(ctx.fps),
    "-t", durStr,
    "-i", imagePath,
    "-vf",
    `scale=${ctx.width}:${ctx.height}:force_original_aspect_ratio=increase,` +
      `crop=${ctx.width}:${ctx.height},format=yuv420p,fps=${ctx.fps}`,
    "-an",
    "-r", String(ctx.fps),
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-threads", "2",
    "-pix_fmt", "yuv420p",
    "-t", durStr,
    clipPath,
  ];
}

/**
 * A real stock-footage clip normalized to the scene: loop if the source is
 * shorter than the narration, scale-crop to fill the vertical frame, trim to the
 * exact scene duration, force fps, and DROP the clip's own audio (the narration
 * is the only audio). `-stream_loop -1` before the input repeats it as needed.
 */
function stockClipArgs(videoPath: string, duration: number, ctx: CompositionContext, clipPath: string): string[] {
  const durStr = duration.toString();
  return [
    "-y",
    "-stream_loop", "-1",
    "-i", videoPath,
    "-t", durStr,
    "-an",
    "-vf",
    `scale=${ctx.width}:${ctx.height}:force_original_aspect_ratio=increase,` +
      `crop=${ctx.width}:${ctx.height},format=yuv420p,fps=${ctx.fps}`,
    "-r", String(ctx.fps),
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-threads", "2",
    "-pix_fmt", "yuv420p",
    "-t", durStr,
    clipPath,
  ];
}

/** A plain black clip (used when a segment has no image). */
function colorClipArgs(duration: number, ctx: CompositionContext, clipPath: string): string[] {
  const durStr = duration.toString();
  return [
    "-y",
    "-f", "lavfi",
    "-i", `color=c=black:s=${ctx.width}x${ctx.height}:r=${ctx.fps}`,
    "-t", durStr,
    "-vf", "format=yuv420p",
    "-r", String(ctx.fps),
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-threads", "2",
    "-pix_fmt", "yuv420p",
    "-t", durStr,
    clipPath,
  ];
}

/** Concatenate per-segment voice clips into one narration track. */
function voiceConcatArgs(audioPaths: readonly string[], voicePath: string): string[] {
  const args: string[] = ["-y"];
  for (const path of audioPaths) {
    args.push("-i", path);
  }
  const labels = audioPaths.map((_, i) => `[${i}:a]`).join("");
  args.push(
    "-filter_complex", `${labels}concat=n=${audioPaths.length}:v=0:a=1[a]`,
    "-map", "[a]",
    "-ar", "44100",
    "-ac", "2",
    voicePath,
  );
  return args;
}

/** Final render: concat video + voice + (ducked) music + burned captions → MP4. */
function finalArgs(opts: {
  readonly listPath: string;
  readonly voicePath?: string;
  readonly musicPath?: string;
  readonly captionsPath?: string;
  readonly ctx: CompositionContext;
  readonly totalStr: string;
}): string[] {
  const { listPath, voicePath, musicPath, captionsPath, ctx, totalStr } = opts;

  const args: string[] = ["-y", "-f", "concat", "-safe", "0", "-i", listPath];
  let voiceIdx = -1;
  let musicIdx = -1;
  let next = 1;
  if (voicePath) {
    args.push("-i", voicePath);
    voiceIdx = next++;
  }
  if (musicPath) {
    args.push("-i", musicPath);
    musicIdx = next++;
  }

  const chains: string[] = [];
  const videoMap = captionsPath ? "[v]" : "0:v";
  if (captionsPath) {
    chains.push(`[0:v]subtitles=${captionsPath}[v]`);
  }

  // Normalize the final mix to ~-16 LUFS (social-media loudness) so the narration
  // is clearly audible; alimiter guards the true peak. Without this the TTS mix is
  // far too quiet (~-26 dB).
  let audioMap: string | undefined;
  if (voiceIdx >= 0 && musicIdx >= 0) {
    chains.push(
      `[${musicIdx}:a]volume=${ctx.musicVolume}[m];` +
      `[${voiceIdx}:a][m]amix=inputs=2:duration=first:normalize=0,` +
      `loudnorm=I=-16:TP=-1.5,aresample=44100,alimiter=limit=0.95[a]`,
    );
    audioMap = "[a]";
  } else if (voiceIdx >= 0) {
    chains.push(`[${voiceIdx}:a]loudnorm=I=-16:TP=-1.5,aresample=44100,alimiter=limit=0.95[a]`);
    audioMap = "[a]";
  }

  if (chains.length > 0) {
    args.push("-filter_complex", chains.join(";"));
  }
  args.push("-map", videoMap);
  if (audioMap) {
    args.push("-map", audioMap);
  }

  args.push(
    "-r", String(ctx.fps),
    "-c:v", "libx264",
    // The FINAL encode is the only one a viewer sees, so spend time here: a
    // slower preset buys real quality at the same file size. (Intermediate
    // per-scene clips stay on `veryfast` — they're throwaway.)
    "-preset", "slow",
    // Cap threads so x264 doesn't spawn one per HOST core and OOM the container.
    "-threads", "2",
    // Visually-lossless-ish quality, with a hard ceiling. Real stock footage
    // carries far more detail than stills and blew past Telegram's 50 MB upload
    // limit at x264's defaults; `slow` + crf 21 lands well under it and looks
    // markedly better than the crf 26 it replaces.
    "-crf", "21",
    "-maxrate", "5200k",
    "-bufsize", "10400k",
    "-profile:v", "high",
    "-pix_fmt", "yuv420p",
    // Let players start before the whole file downloads.
    "-movflags", "+faststart",
  );
  if (audioMap) {
    args.push("-c:a", "aac", "-b:a", "192k");
  }
  args.push("-movflags", "+faststart", "-t", totalStr, ctx.outputPath);
  return args;
}

async function fileBytes(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
