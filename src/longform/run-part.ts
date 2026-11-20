import { mkdir } from "node:fs/promises";
import {
  OpenAIImageGenerationProvider,
  assertImageModelAvailable,
} from "../providers/image-generation/index.js";
import { OpenAIVoiceGenerationProvider } from "../providers/voice-generation/index.js";
import { FfmpegCompositionProvider } from "../providers/composition/index.js";
import { assertMediaTools } from "../lib/binaries.js";
import { research } from "./research.js";
import { LongformScriptWriter, WORDS_PER_MINUTE } from "./script.js";
import type { ScriptBeat } from "./script.js";
import { ScriptVerifier } from "./verify.js";
import {
  createSeriesStore,
  continuationBrief,
  seriesIdFor,
  type SeriesRecord,
  type SeriesStore,
} from "./series.js";
import type { AssetPlan } from "../providers/asset-planning/index.js";
import type { GeneratedImage, GeneratedImages } from "../providers/image-generation/index.js";
import type { NarrativeScript } from "../providers/narrative/index.js";

/**
 * ONE PART of a documentary series, end to end.
 *
 * Long subjects are told as a run of normal-length videos — part one today,
 * part two tomorrow — rather than as one long render. Each part is
 * independently watchable, costs pennies, and a failure loses one part rather
 * than an hour of work.
 *
 * Calling this twice for the same topic produces part one then part two: the
 * series store remembers what has been covered, and the writer is told to
 * continue rather than start again.
 */

/** The locked visual identity, appended to every image prompt. */
export const STYLE = [
  "Hand-drawn 2D cartoon illustration in a flat webcomic style.",
  "Bold uniform black ink outlines, clean line art, subtle paper grain texture.",
  "Every character has a plain rounded blank head with small simple dot eyes and a",
  "simple mouth. No hair detail, no nose, no blush, no wrinkles, no realistic faces,",
  "no portrait likeness — characters are anonymous everyman figures at every age.",
  "Muted warm palette: burnt orange, cream, soft brown, sage green, dusty teal.",
  "Richly detailed background environment drawn in the same line weight as the characters.",
  "Soft even lighting, no photorealism, no 3D render, no anime.",
  "Wide 16:9 composition with the main action centred.",
  "Absolutely no text, no letters, no numbers, no writing anywhere in the image.",
].join(" ");

const WORDS_PER_SECOND = WORDS_PER_MINUTE / 60;

export interface PartRequest {
  readonly topic: string;
  readonly targetSeconds?: number;
  readonly workDir?: string;
  readonly onStep?: (message: string) => void;
}

export interface PartResult {
  readonly seriesId: string;
  readonly part: number;
  readonly title: string;
  readonly videoPath: string;
  readonly durationSeconds: number;
  readonly beats: number;
  readonly flagged: number;
  readonly imagesCostUsd: number;
  readonly citations: readonly string[];
  /** True when the writer judged the subject finished. */
  readonly complete: boolean;
}

export async function runPart(request: PartRequest, store: SeriesStore = createSeriesStore()): Promise<PartResult> {
  const log = request.onStep ?? (() => {});
  const topic = request.topic.trim();
  const targetSeconds = request.targetSeconds ?? 55;
  const seriesId = seriesIdFor(topic);

  // Check the tooling before anything is spent.
  await assertMediaTools();
  await assertImageModelAvailable();

  const existing = await store.get(seriesId);
  const part = (existing?.parts.length ?? 0) + 1;
  if (existing?.complete) {
    log(`✅ "${topic}" is already complete after ${existing.parts.length} part(s).`);
  }

  const workDir = request.workDir ?? `output/longform/${seriesId}/part-${part}`;
  await mkdir(workDir, { recursive: true });
  log(`📚 ${topic} — part ${part}`);

  /* ------------------------------ sources ------------------------------ */
  log("🔎 Researching…");
  const sources = await research(topic);
  if (sources.articles.length === 0) {
    // Refuse rather than narrate from memory: an unsourced script is fluent,
    // confident and unverifiable, which is the one thing this format must not
    // produce.
    throw new Error(
      sources.failure === "failed"
        ? "Source lookup failed (rate limited or offline). Refusing to write from memory — try again shortly."
        : `No sources found for "${topic}". Refusing to write from memory — try naming the subject more directly.`,
    );
  }
  log(`   ${sources.articles.map((article) => article.title).join(", ")}`);

  /* ------------------------------- script ------------------------------- */
  log("✍️ Writing…");
  const script = await new LongformScriptWriter().write({
    topic,
    targetSeconds,
    sourceText: sources.sourceText,
    previously: continuationBrief(existing),
    part,
  });
  if (script.beats.length === 0) throw new Error("The writer returned no usable beats.");
  log(`   "${script.title}" — ${script.beats.length} beats, ${script.estimatedWords} words`);

  /* ----------------------------- fact check ----------------------------- */
  log("🔍 Fact checking…");
  const verified = await new ScriptVerifier().verify(script.beats, sources.sourceText);
  if (verified.checks.length === 0) {
    log("   ⚠️ not checked — facts are UNVERIFIED");
  } else {
    log(`   ${verified.checks.length} checked, ${verified.problems.length} flagged`);
    for (const problem of verified.problems) {
      log(`   • beat ${problem.index + 1}: ${problem.problem.slice(0, 110)}`);
    }
  }
  const beats = verified.beats;
  if (beats.length === 0) throw new Error("Every beat failed the fact check — refusing to build from it.");

  /* ------------------------- narrate and illustrate ------------------------- */
  log("🎙 Narrating…");
  const voiceover = await new OpenAIVoiceGenerationProvider().generate({
    narrative: buildNarrative(beats),
    context: {
      outputDir: `${workDir}/audio`,
      // Slightly faster than natural. Explainer channels run quick — the
      // reference video sits near 154 words per minute — and at 1.0 the
      // narration drags, which drags the pictures with it because each image is
      // held for exactly as long as its line takes to say. Raising this speeds
      // the WHOLE video uniformly rather than just the voice.
      speed: Number(process.env.LONGFORM_VOICE_SPEED ?? 1.12),
      // "onyx" is the deep one. The studio default, "alloy", is light and
      // neutral — fine for a short, thin for documentary narration, where the
      // voice has to carry a minute on its own.
      voice: process.env.LONGFORM_VOICE?.trim() || "onyx",
      // gpt-4o-mini-tts takes delivery direction, which is the lever for
      // "clearer": diction and placement are steerable even though pitch is
      // fixed by the voice. Without this it reads the lines; with it, it
      // performs them.
      instructions:
        process.env.LONGFORM_VOICE_STYLE?.trim() ||
        "Speak as a documentary narrator: deep, resonant chest voice with warm low tone. " +
          "Crisp, deliberate diction — every consonant lands. Confident and authoritative, " +
          "never breathless or salesy. Measured pace with a slight lift into each new fact, " +
          "and a firm downward close on the final sentence.",
    },
  });

  log("🎨 Illustrating…");
  const images = await new OpenAIImageGenerationProvider().generate({
    assetPlan: buildAssetPlan(beats, voiceover.segments.map((segment) => segment.segmentId)),
    context: {
      size: "1536x1024",
      // "medium" rather than the studio-wide "low". Low is genuinely fine for a
      // throwaway test — flat cartoon art barely uses the extra detail budget —
      // but this is published work, and the difference costs about thirteen
      // cents a part. Measured on gpt-image-2.6-flare at 1536x1024: 664 output
      // tokens at low against 1,132 at medium, or $0.020 against $0.034 an
      // image. Override with LONGFORM_IMAGE_QUALITY.
      quality: process.env.LONGFORM_IMAGE_QUALITY?.trim() || "medium",
      styleSuffix: STYLE,
      outputDir: `${workDir}/images`,
    },
  });
  const made = images.images.filter((image) => image.status === "generated").length;
  log(`   ${made}/${beats.length} images`);
  if (made === 0) {
    // Composition would otherwise produce a video of blank colour cards and
    // report success.
    throw new Error("No images were generated — refusing to build a video of blank cards.");
  }

  // Cover any gap with a neighbouring illustration. Composition falls back to a
  // colour card for a missing image, which in practice is six seconds of pure
  // black in the middle of the video — measured on a run where one image of
  // nine failed. A repeated picture is barely noticeable; a black hole is not.
  const filled = fillImageGaps(
    images,
    voiceover.segments.map((segment) => segment.segmentId),
  );
  if (filled.reused > 0) {
    log(`   reused ${filled.reused} neighbouring image(s) to cover failures`);
  }

  /* ------------------------------- compose ------------------------------- */
  log("🎬 Composing…");
  const composed = await new FfmpegCompositionProvider().compose({
    voiceover,
    images: filled.images,
    context: {
      width: 1920,
      height: 1080,
      fps: 30,
      outputPath: `${workDir}/part-${part}.mp4`,
      workDir: `${workDir}/compose`,
      kenBurns: true,
      // No music bed, so the narration carries the whole track and should sit
      // at full platform level. Composition normalises to -16 LUFS, which is
      // the right target when a voice has to share room with music; alone it
      // just sounds quiet. -14 is what YouTube and the rest normalise to.
      loudnessTargetLufs: -14,
    },
  });

  /* -------------------------- remember this part -------------------------- */
  const record: SeriesRecord = {
    seriesId,
    topic,
    citations: sources.citations,
    parts: [
      ...(existing?.parts ?? []),
      {
        part,
        title: script.title,
        // The writer summarises BEFORE the fact check runs, so its summary can
        // describe beats that were then dropped — one run ended "on a
        // cliffhanger hinting at emerging competition" when exactly that beat
        // had been removed as unsupported. The next part would then be told to
        // continue from something the viewer never saw. Correcting the summary
        // against what actually shipped keeps the series honest with itself.
        summary: summariseShipped(script.summary, script.beats.length, beats),
        lastLine: beats.at(-1)!.text,
        createdAt: new Date().toISOString(),
        videoPath: composed.videoPath,
      },
    ],
    complete: script.complete,
  };
  await store.save(record);

  return {
    seriesId,
    part,
    title: script.title,
    videoPath: composed.videoPath,
    durationSeconds: composed.durationSeconds,
    beats: beats.length,
    flagged: verified.problems.length,
    // Per-image cost tracks the quality tier, so a report does not quietly
    // keep quoting the cheap price after the tier has been raised.
    imagesCostUsd: Math.round(made * imagePriceUsd() * 100) / 100,
    citations: sources.citations,
    complete: script.complete,
  };
}

/* -------------------------------- helpers -------------------------------- */

/**
 * The summary as it applies to what SHIPPED, not what was written.
 *
 * When the fact check drops beats, the writer's own summary can describe
 * material that is no longer in the video. Rather than ask for a fresh summary
 * — another call, and the writer would only be guessing at its own cuts — the
 * summary is annotated with how the part really ends, which is what the next
 * part needs in order to continue from the right place.
 */
export function summariseShipped(
  written: string,
  writtenBeats: number,
  shipped: readonly ScriptBeat[],
): string {
  const base = written.trim();
  if (shipped.length === writtenBeats || shipped.length === 0) return base;

  const dropped = writtenBeats - shipped.length;
  return (
    `${base}\n\n(Note: ${dropped} beat(s) were removed by the fact check, so this part ` +
    `actually ends on: "${shipped.at(-1)!.text}")`
  );
}

/**
 * Measured cost of one image at the configured quality tier.
 *
 * Images are billed per output token at $30/1M, and the tier moves that a lot:
 * on gpt-image-2.6-flare at 1536x1024, low came back at 664 output tokens and
 * medium at 1,132. Hard-coding one number would mean a run kept reporting the
 * cheap price after the tier was raised.
 */
function imagePriceUsd(): number {
  switch (process.env.LONGFORM_IMAGE_QUALITY?.trim() || "medium") {
    case "low":
      return 0.02;
    case "high":
      return 0.17;
    default:
      return 0.034;
  }
}

/**
 * Give every narration segment an image, borrowing from its neighbours when its
 * own failed to generate.
 *
 * Composition pairs images to segments by id and falls back to a colour card
 * when one is missing. That fallback is right in principle but awful in
 * practice: a run where one image of nine failed produced six seconds of pure
 * black mid-video (measured: YLOW, YAVG and YHIGH all 16, a perfectly uniform
 * frame). The nearest illustration is a far better answer — it shows a picture
 * that is at least thematically close, and viewers do not notice a repeat
 * nearly as much as they notice a hole.
 *
 * Searches outward from the gap so it takes the closest image either side,
 * which keeps the borrowed picture as relevant as possible.
 */
export function fillImageGaps(
  images: GeneratedImages,
  segmentIds: readonly string[],
): { images: GeneratedImages; reused: number } {
  const usable = new Map(
    images.images
      .filter((image) => image.status === "generated" && image.imagePath !== "")
      .map((image) => [image.segmentId, image]),
  );
  if (usable.size === 0 || usable.size === segmentIds.length) {
    return { images, reused: 0 };
  }

  const patched: GeneratedImage[] = [];
  let reused = 0;

  for (const [index, segmentId] of segmentIds.entries()) {
    const own = usable.get(segmentId);
    if (own) {
      patched.push(own);
      continue;
    }
    // Walk outward: 1 before, 1 after, 2 before, 2 after…
    let donor: GeneratedImage | undefined;
    for (let distance = 1; distance <= segmentIds.length && !donor; distance++) {
      donor =
        usable.get(segmentIds[index - distance] ?? "") ?? usable.get(segmentIds[index + distance] ?? "");
    }
    if (!donor) continue; // nothing to borrow; composition will card it
    reused++;
    patched.push({ ...donor, segmentId });
  }

  return { images: { ...images, images: patched }, reused };
}

function buildNarrative(beats: readonly ScriptBeat[]): NarrativeScript {
  let cursor = 0;
  const segments = beats.map((beat, index) => {
    const duration = Math.max(3, beat.text.split(/\s+/u).length / WORDS_PER_SECOND);
    const segment = {
      segmentId: `beat-${String(index + 1).padStart(2, "0")}`,
      startSecond: cursor,
      endSecond: cursor + duration,
      text: beat.text,
      emotion: "measured",
      visualHint: beat.visual,
    };
    cursor += duration;
    return segment;
  });

  return {
    hook: beats[0]?.text ?? "",
    segments,
    callToAction: "",
    estimatedDurationSeconds: cursor,
    warnings: [],
    metadata: {},
  } as unknown as NarrativeScript;
}

/**
 * Image ids come from the VOICEOVER, because composition pairs them by
 * segmentId and the voice provider assigns its own. Naming images
 * independently matches nothing, and every segment silently becomes a colour
 * card while the run still reports success.
 */
function buildAssetPlan(beats: readonly ScriptBeat[], segmentIds: readonly string[]): AssetPlan {
  return {
    segments: beats.map((beat, index) => ({
      segmentId: segmentIds[index] ?? `seg-${index + 1}`,
      assetType: "image",
      primaryProvider: "openai",
      fallbackProvider: "openai",
      searchQueries: [],
      visualPrompt: beat.visual,
      estimatedDuration: 6,
      licenseRequirements: "generated",
      notes: "",
    })),
  } as unknown as AssetPlan;
}
