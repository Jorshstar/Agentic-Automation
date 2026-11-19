import { join } from "node:path";
import { resolveSource, fetchAutoCaptions, isRemoteUrl } from "./source-download.js";
import { transcribe, transcribeWindows } from "./transcribe.js";
import type { Transcript, TranscriptSegment, TranscriptWord } from "./transcribe.js";
import { analyzeAudio } from "./audio-energy.js";
import { detectSceneCuts } from "./scene-detect.js";
import { ClipMomentSelector } from "./select-moments.js";
import type { ClipMoment } from "./select-moments.js";
import { planForTheme, effectiveMode } from "./themes.js";
import type { ThemePlan } from "./themes.js";
import { planReframe, defaultModeForTheme, parseLayoutInstruction } from "./reframe.js";
import type { ReframeMode } from "./reframe.js";
import { renderClip } from "./render-clip.js";
import type { CaptionPresetName } from "./captions.js";
import { checkClip, describeIssues } from "./qa.js";
import { TelegramDeliveryProvider } from "../providers/delivery/index.js";
import { TelegramClient } from "../telegram/telegram-client.js";
import { assertMediaTools } from "../lib/binaries.js";

/**
 * THE CLIP PIPELINE, in one function, so the cloud task and the local worker run
 * identical logic.
 *
 *   resolve source (link or local file)
 *     → measure signals (loudness events, scene cuts)
 *     → get a transcript to CHOOSE from (free auto-captions where possible)
 *     → select moments, theme-aware and scored
 *     → get exact word timings for the CHOSEN windows only
 *     → reframe + render + caption, in parallel
 *     → QA each output
 *     → deliver, best context first
 *
 * Two decisions here are worth calling out because they are what changed:
 *
 * NO SPEECH IS NOT A FAILURE. The previous version returned zero clips whenever
 * a video had no transcript, which killed every music-only highlight reel — the
 * exact case "clip the goals" lives in. Now a speechless source drops into
 * signal-driven selection instead.
 *
 * TRANSCRIPTION IS SPLIT IN TWO. Choosing moments needs rough text for the whole
 * video; burning captions needs exact timings for a couple of minutes of it. We
 * take the rough pass free from the platform's own auto-captions when we can,
 * and spend Whisper only on the windows that actually ship.
 */

export interface ClipJob {
  /**
   * A video link (anything yt-dlp handles) OR a path to a local file. May be
   * empty when {@link ClipJob.fileId} is set.
   */
  readonly url: string;
  /**
   * Telegram file_id of a video the user uploaded into the chat. Downloaded to
   * the work directory and clipped like any other local file.
   *
   * Note the hard ceiling: the Bot API refuses getFile over 20 MB, so an upload
   * is roughly a couple of minutes of video. Longer sources have to come in as
   * a link.
   */
  readonly fileId?: string;
  /** What to clip: "goals", "funny moments", "emotional", "auto", … */
  readonly theme: string;
  readonly count: number;
  /**
   * How to lay out the vertical frame. Accepts a mode name ("smart", "wide",
   * "fit", "fit-top") OR the user's own words — "show the whole video", "fill
   * the screen", "zoom in on him". Unrecognised text falls back to the theme's
   * default rather than failing.
   */
  readonly reframe?: ReframeMode | string;
  /** Override the caption style chosen for the theme. */
  readonly captionPreset?: CaptionPresetName;
}

export interface RenderedClip {
  readonly path: string;
  readonly hook: string;
  readonly score: number;
  readonly startSecond: number;
  readonly endSecond: number;
  readonly durationSeconds: number;
  readonly evidence: readonly string[];
  readonly delivered: boolean;
}

export interface ClipJobResult {
  readonly delivered: number;
  readonly found: number;
  readonly title: string;
  readonly clips: readonly RenderedClip[];
  /** Audio minutes actually sent to Whisper — the main variable cost. */
  readonly transcribedMinutes: number;
}

/** Sources longer than this are worth trying free auto-captions on first. */
const AUTO_CAPTION_MIN_SECONDS = 600;
/** Clips rendered at once. Each ffmpeg uses 2 threads, so 2 saturates 4 cores. */
const RENDER_CONCURRENCY = Number(process.env.CLIP_RENDER_CONCURRENCY ?? 2);
const MAX_CLIPS = 8;

export async function runClipJob(
  job: ClipJob,
  opts: {
    workDir: string;
    onStep?: (message: string) => void;
    /**
     * Send the finished clips to Telegram. Default true. Set false to render
     * and keep the files locally — what you want while tuning themes, layouts
     * or captions, so testing does not flood the chat.
     */
    deliver?: boolean;
  },
): Promise<ClipJobResult> {
  const log = opts.onStep ?? (() => {});
  const plan = planForTheme(job.theme);
  const count = Math.min(Math.max(job.count || 5, 1), MAX_CLIPS);

  // Check the tooling BEFORE anything expensive. A missing ffmpeg used to
  // surface as a bare ENOENT after the source had already been downloaded.
  await assertMediaTools();

  /* ---------------------------- 1. the source ---------------------------- */
  // Three ways in: a Telegram upload, a link, or a path already on this machine.
  const input = job.fileId
    ? await fetchUpload(job.fileId, opts.workDir, log)
    : job.url.trim();
  if (input === "") {
    throw new Error("No video given — send a link or upload a video file.");
  }
  if (!job.fileId) {
    log(isRemoteUrl(input) ? "⛏ Grabbing the video…" : "📂 Reading your file…");
  }
  const source = await resolveSource(input, opts.workDir);
  const minutes = Math.round(source.durationSeconds / 60);
  log(`🎞 "${source.title.slice(0, 70)}" — ${minutes} min. Looking for ${describeTheme(plan)}.`);

  /* --------------------------- 2. cheap signals -------------------------- */
  // Both are pure ffmpeg passes with no API cost, and they are independent.
  log("🔊 Measuring audio and cuts…");
  const [audio, sceneCuts] = await Promise.all([
    analyzeAudio(source.videoPath),
    plan.needsSceneDetection ? detectSceneCuts(source.videoPath) : Promise.resolve([]),
  ]);
  const surges = audio.events.filter((event) => event.kind === "surge").length;
  log(`   ${audio.events.length} audio event(s), ${surges} sustained; ${sceneCuts.length} scene cut(s).`);

  /* ----------------------- 3. transcript for choosing ---------------------- */
  const selection = await transcriptForSelection(input, source.videoPath, source.durationSeconds, opts.workDir, log);
  const wordCount = countWords(selection.segments);
  const mode = effectiveMode(plan, wordCount, source.durationSeconds);
  if (mode === "action" && plan.mode !== "action") {
    log("🎵 Barely any speech here — switching to audio-and-cuts detection.");
  }

  /* --------------------------- 4. pick moments --------------------------- */
  log(`🎯 Finding the best ${describeTheme(plan)}…`);
  const moments = await new ClipMomentSelector().select({
    plan,
    mode,
    count,
    title: source.title,
    description: source.description,
    durationSeconds: source.durationSeconds,
    segments: selection.segments,
    audio,
    sceneCuts,
    chapters: source.chapters,
    onWarn: log,
  });

  // Reported on every exit path, so it is accumulated in one place and rounded
  // in one place — four separate returns had drifted into reporting it three
  // different ways, one of them an unrounded float.
  let transcribedMinutes = selection.minutes;

  if (moments.length === 0) {
    log(`🤔 Nothing here matches ${describeTheme(plan)}. Try another angle or another video.`);
    return { delivered: 0, found: 0, title: source.title, clips: [], transcribedMinutes: round1(transcribedMinutes) };
  }
  log(`   ${moments.length} candidate(s): ${moments.map((m) => `${m.score}`).join(", ")} /100.`);

  /* ------------------- 5. exact word timings, chosen windows ------------------- */
  let words: readonly TranscriptWord[] = selection.words;
  if (words.length === 0 && wordCount > 0) {
    log("📝 Transcribing just the selected moments…");
    const windowed = await transcribeWindows(
      source.videoPath,
      moments.map((moment) => ({ start: moment.startSecond, end: moment.endSecond })),
      join(opts.workDir, "windows"),
    );
    words = windowed.words;
    transcribedMinutes += windowed.minutes;
  }

  // Only snap to words when words are what defines the moment. In action mode
  // the boundary comes from the crowd and the edit, and snapping to a stray
  // commentary word would drag the clip off the goal.
  const finalMoments =
    mode === "action" || words.length === 0
      ? moments
      : moments.map((moment) => snapToWords(moment, words, plan));

  /* ----------------------------- 6. render ----------------------------- */
  log(`✂️ Cutting ${finalMoments.length} clip(s)…`);
  // The user's words win over the theme's default, so "clip the goals but show
  // the full video" does what it says.
  const reframeMode =
    parseLayoutInstruction(job.reframe ?? "") ??
    parseLayoutInstruction(plan.theme) ??
    defaultModeForTheme(plan);
  log(`🖼 Layout: ${describeLayout(reframeMode)}`);
  const captionPreset = job.captionPreset ?? plan.captionPreset;

  const rendered = await mapWithConcurrency(
    finalMoments,
    RENDER_CONCURRENCY,
    async (moment, index): Promise<RenderedClip | undefined> => {
    const outPath = join(opts.workDir, `clip-${index + 1}.mp4`);
    const reframe = await planReframe({
      sourcePath: source.videoPath,
      startSecond: moment.startSecond,
      endSecond: moment.endSecond,
      workDir: join(opts.workDir, `clip-${index + 1}`),
      mode: reframeMode,
    });

    const result = await renderClip({
      sourcePath: source.videoPath,
      startSecond: moment.startSecond,
      endSecond: moment.endSecond,
      words,
      outPath,
      assPath: join(opts.workDir, `clip-${index + 1}.ass`),
      reframe,
      captionPreset,
      hook: moment.hook,
      // Dead air is only dead when someone is supposed to be talking.
      tighten: mode !== "action",
    });
    if (!result.ok) {
      log(`   ⚠️ Clip ${index + 1} failed to render.`);
      return undefined;
    }

    const qa = await checkClip(outPath, result.durationSeconds);
    if (!qa.ok) {
      log(`   ⚠️ Clip ${index + 1} rejected: ${describeIssues(qa.issues)}`);
      return undefined;
    }

    log(`   ✅ Clip ${index + 1} (${moment.score}/100) — ${result.note}`);
    return {
      path: outPath,
      hook: moment.hook,
      score: moment.score,
      startSecond: moment.startSecond,
      endSecond: moment.endSecond,
      durationSeconds: qa.durationSeconds ?? result.durationSeconds,
      evidence: moment.evidence,
      delivered: false,
      };
    },
  );

  const good = rendered.filter((clip): clip is RenderedClip => clip !== undefined);
  if (good.length === 0) {
    log("❌ Every clip failed to render. Nothing to send.");
    return {
      delivered: 0,
      found: finalMoments.length,
      title: source.title,
      clips: [],
      transcribedMinutes: round1(transcribedMinutes),
    };
  }

  /* ---------------------------- 7. deliver ---------------------------- */
  if (opts.deliver === false) {
    log(`📁 Delivery off — ${good.length} clip(s) left in ${opts.workDir}`);
    return {
      delivered: 0,
      found: finalMoments.length,
      title: source.title,
      clips: good,
      transcribedMinutes: round1(transcribedMinutes),
    };
  }

  // Sequential on purpose: Telegram rate-limits uploads, and a burst of parallel
  // sends gets throttled and arrives out of order.
  const delivery = new TelegramDeliveryProvider();
  const finalClips: RenderedClip[] = [];
  let delivered = 0;
  for (const clip of good) {
    const result = await delivery.deliver({
      videoPath: clip.path,
      caption: buildCaption(clip, source.title),
      documents: [],
    });
    if (result.videoSent) delivered++;
    finalClips.push({ ...clip, delivered: result.videoSent });
  }

  return {
    delivered,
    found: finalMoments.length,
    title: source.title,
    clips: finalClips,
    transcribedMinutes: round1(transcribedMinutes),
  };
}

/* -------------------------------- upload -------------------------------- */

/**
 * Pull a video the user uploaded to Telegram onto local disk.
 *
 * The Bot API caps getFile at 20 MB, which is the real constraint on this path —
 * so the error says that plainly rather than leaving the user guessing why a
 * perfectly normal video was refused.
 */
async function fetchUpload(fileId: string, workDir: string, log: (message: string) => void): Promise<string> {
  log("📂 Downloading your upload…");
  const destination = join(workDir, "upload.mp4");
  const result = await new TelegramClient().download(fileId, destination);
  if (!result.ok) {
    throw new Error(
      `Couldn't fetch that upload: ${result.error}. ` +
        "Telegram bots can only download files up to 20 MB — for anything longer, send a link instead.",
    );
  }
  log(`   got ${(result.bytes / 1_000_000).toFixed(1)} MB.`);
  return destination;
}

/* ------------------------------ transcript ------------------------------ */

interface SelectionTranscript {
  readonly segments: readonly TranscriptSegment[];
  /** Populated only when a FULL Whisper pass ran; otherwise filled in later. */
  readonly words: readonly TranscriptWord[];
  readonly minutes: number;
}

/**
 * Get text to choose moments from, as cheaply as the source allows.
 *
 * For a long link we first ask the platform for its own auto-captions. They are
 * free and instant, and their accuracy — fine for picking moments, not good
 * enough to burn on screen — is exactly the trade we want here. Only if they are
 * unavailable do we pay for a full Whisper pass.
 */
async function transcriptForSelection(
  input: string,
  videoPath: string,
  durationSeconds: number,
  workDir: string,
  log: (message: string) => void,
): Promise<SelectionTranscript> {
  if (isRemoteUrl(input) && durationSeconds >= AUTO_CAPTION_MIN_SECONDS) {
    const captions = await fetchAutoCaptions(input, join(workDir, "subs"));
    if (captions && captions.length > 20) {
      log(`📄 Using the platform's own captions to choose from (free, ${captions.length} lines).`);
      return { segments: captions, words: [], minutes: 0 };
    }
  }

  log("📝 Transcribing…");
  let full: Transcript;
  try {
    full = await transcribe(videoPath, join(workDir, "audio"));
  } catch (error) {
    // A transcription failure must not end the job: audio and cut detection
    // can still find action moments without a single word.
    log(`⚠️ Transcription failed (${short(error)}) — falling back to audio detection.`);
    return { segments: [], words: [], minutes: 0 };
  }
  return { segments: full.segments, words: full.words, minutes: full.minutes };
}

function countWords(segments: readonly TranscriptSegment[]): number {
  let total = 0;
  for (const segment of segments) {
    total += segment.text.split(/\s+/u).filter((word) => word !== "").length;
  }
  return total;
}

/* -------------------------------- helpers -------------------------------- */

/**
 * Snap a moment's edges to word boundaries so no word is cut in half, then hold
 * it inside the theme's length bounds.
 */
export function snapToWords(
  moment: ClipMoment,
  words: readonly TranscriptWord[],
  plan: ThemePlan,
): ClipMoment {
  if (words.length === 0) return moment;

  const startWord = words.find((word) => word.start >= moment.startSecond - 0.3) ?? words[0]!;
  const before = words.filter((word) => word.end <= moment.endSecond + 0.3);
  const endWord = before.length > 0 ? before[before.length - 1]! : startWord;

  const start = startWord.start;
  let end = Math.max(endWord.end, start + plan.duration.min);
  if (end - start > plan.duration.max) end = start + plan.duration.max;
  return { ...moment, startSecond: start, endSecond: end };
}

/** The Telegram caption: what it is, how confident we are, and why. */
function buildCaption(clip: RenderedClip, sourceTitle: string): string {
  const evidence = clip.evidence.length > 0 ? `\n🔎 ${clip.evidence.slice(0, 2).join(" · ")}` : "";
  return (
    `🎬 ${clip.hook}\n` +
    `⭐ ${clip.score}/100 · ${Math.round(clip.durationSeconds)}s · from ${formatTimestamp(clip.startSecond)}` +
    `${evidence}\n\n` +
    `Clipped from "${sourceTitle.slice(0, 90)}"`
  );
}

function formatTimestamp(seconds: number): string {
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const mm = String(minutes).padStart(hours > 0 ? 2 : 1, "0");
  return hours > 0
    ? `${hours}:${mm}:${String(secs).padStart(2, "0")}`
    : `${mm}:${String(secs).padStart(2, "0")}`;
}

/** Plain-words description of a layout, so the choice is visible in the log. */
function describeLayout(mode: ReframeMode): string {
  switch (mode) {
    case "smart":
      return "full screen, tracking the speaker (sides cropped)";
    case "wide":
      return "wide crop — more of the scene, still fills most of the frame";
    case "fit-top":
      return "whole frame kept, parked high";
    case "fit":
    default:
      return "whole frame kept (blurred bars above and below)";
  }
}

function describeTheme(plan: ThemePlan): string {
  return plan.theme === "auto" ? "the strongest moments" : `"${plan.theme}"`;
}

/** One decimal place — minutes of audio billed, not a physics measurement. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function short(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 120);
}

/**
 * Run an async mapper over a list with a bounded number in flight, preserving
 * input order in the result. Rendering is CPU-bound, so firing every clip at
 * once would thrash the machine and finish no sooner.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}
