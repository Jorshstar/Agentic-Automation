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
    context: { outputDir: `${workDir}/audio` },
  });

  log("🎨 Illustrating…");
  const images = await new OpenAIImageGenerationProvider().generate({
    assetPlan: buildAssetPlan(beats, voiceover.segments.map((segment) => segment.segmentId)),
    context: { size: "1536x1024", styleSuffix: STYLE, outputDir: `${workDir}/images` },
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
        summary: script.summary,
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
    imagesCostUsd: Math.round(made * 0.02 * 100) / 100,
    citations: sources.citations,
    complete: script.complete,
  };
}

/* -------------------------------- helpers -------------------------------- */

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
