/**
 * LONG-FORM SAMPLE — a minute of the documentary format, on ANY topic.
 *
 *   npm run longform:sample -- "the history of Nintendo"
 *   npm run longform:sample -- "why the Concorde stopped flying" 60
 *
 * Topic -> script -> narration -> illustrations -> composed 16:9 video, using
 * the studio's real providers rather than anything bespoke.
 *
 * The script is GENERATED, not written here. An earlier version of this demo
 * used a hand-written script about the same company as the reference video,
 * which proved almost nothing: it showed the look could be reproduced on the
 * one subject already studied, and left open whether the format works on a
 * topic nobody had tuned for. Naming the topic at the command line is the test
 * that actually means something.
 *
 * Still out of scope: research and fact verification. The writer is told to
 * stick to claims it is confident in and to write around anything uncertain,
 * which is weaker than checking. `research-verification` plugs in later and
 * matters far more for history than it does for fiction.
 *
 * Costs roughly $0.25 for a minute: ten images at about $0.02 plus narration.
 */
import { mkdir } from "node:fs/promises";
import {
  OpenAIImageGenerationProvider,
  assertImageModelAvailable,
} from "../providers/image-generation/index.js";
import { OpenAIVoiceGenerationProvider } from "../providers/voice-generation/index.js";
import { FfmpegCompositionProvider } from "../providers/composition/index.js";
import { assertMediaTools } from "../lib/binaries.js";
import { LongformScriptWriter, WORDS_PER_MINUTE } from "../longform/script.js";
import { research } from "../longform/research.js";
import { ScriptVerifier } from "../longform/verify.js";
import type { ScriptBeat } from "../longform/script.js";
import type { AssetPlan } from "../providers/asset-planning/index.js";
import type { NarrativeScript } from "../providers/narrative/index.js";

try {
  process.loadEnvFile();
} catch {
  /* ambient env */
}

/**
 * The locked visual identity, appended to every image prompt.
 *
 * Two lines earn their place from the style probe: the blank-face rules, and
 * the explicit ban on hair and noses. In an eight-image test one beat said "the
 * same man, older now" and the model answered with hair, a nose and blush —
 * breaking a style that had held across the previous seven. Age and identity
 * must come from here, never from a beat.
 */
const STYLE = [
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
 * Build the image plan against the IDs the VOICEOVER actually came back with.
 *
 * Composition pairs an image to a narration segment by segmentId, and the voice
 * provider assigns its own ("seg-1", "seg-2", …) rather than carrying through
 * the ones the narrative used. Naming images independently therefore matches
 * nothing: every segment falls back to a colour card and the run still reports
 * success, just with no illustrations in it. Deriving the ids from the
 * voiceover cannot drift, whatever either provider decides to call them.
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

async function main(): Promise<void> {
  const topic = process.argv[2];
  if (!topic) {
    console.error('Usage: npm run longform:sample -- "<topic>" [seconds]');
    process.exitCode = 1;
    return;
  }
  const targetSeconds = Number(process.argv[3] ?? 55);

  // Fail here rather than halfway through a run that costs money.
  await assertMediaTools();
  await assertImageModelAvailable();

  const workDir = `output/longform-sample/${Date.now()}`;
  await mkdir(workDir, { recursive: true });

  console.log(`Topic: ${topic}  (~${targetSeconds}s)\n`);

  console.log("Researching…");
  const sources = await research(topic);
  if (sources.articles.length === 0) {
    console.log("  no sources found — the script will be UNGROUNDED, treat its facts with suspicion");
  } else {
    console.log(`  ${sources.articles.length} article(s), ${sources.sourceText.length} chars`);
    for (const article of sources.articles) console.log(`   ${article.title} — ${article.url}`);
  }

  console.log("\nWriting…");
  const script = await new LongformScriptWriter().write({
    topic,
    targetSeconds,
    sourceText: sources.sourceText,
  });
  if (script.beats.length === 0) {
    console.error("The writer returned no usable beats.");
    process.exitCode = 1;
    return;
  }
  console.log(`  "${script.title}" — ${script.beats.length} beats, ${script.estimatedWords} words`);

  console.log("\nFact checking…");
  const verified = await new ScriptVerifier().verify(script.beats, sources.sourceText);
  if (verified.checks.length === 0) {
    console.log("  not checked (no sources, or the checker failed) — facts are UNVERIFIED");
  } else {
    console.log(`  ${verified.checks.length} beats checked, ${verified.problems.length} flagged`);
    for (const problem of verified.problems) {
      console.log(`   beat ${problem.index + 1} ${problem.verdict}: ${problem.problem.slice(0, 140)}`);
      console.log(problem.correction ? `     -> ${problem.correction.slice(0, 140)}` : "     -> dropped");
    }
  }

  const beats = verified.beats;
  if (beats.length === 0) {
    console.error("Every beat failed the fact check — refusing to build a video from it.");
    process.exitCode = 1;
    return;
  }
  console.log("");
  for (const [index, beat] of beats.entries()) console.log(`   ${index + 1}. ${beat.text}`);

  const narrative = buildNarrative(beats);

  console.log("\nNarrating…");
  const voiceover = await new OpenAIVoiceGenerationProvider().generate({
    narrative,
    context: { outputDir: `${workDir}/audio` },
  });
  console.log(
    `  ${voiceover.segments.length} segments, ${voiceover.totalDurationSeconds.toFixed(1)}s actual`,
  );

  console.log("Illustrating…");
  const images = await new OpenAIImageGenerationProvider().generate({
    assetPlan: buildAssetPlan(
      beats,
      voiceover.segments.map((segment) => segment.segmentId),
    ),
    context: {
      // Landscape: this format is 16:9, unlike the vertical shorts.
      size: "1536x1024",
      styleSuffix: STYLE,
      outputDir: `${workDir}/images`,
    },
  });
  const made = images.images.filter((image) => image.status === "generated").length;
  console.log(`  ${made}/${beats.length} images`);
  for (const warning of images.warnings) {
    console.log(`  WARN ${warning.segmentId ?? ""} ${warning.code}: ${warning.message.slice(0, 100)}`);
  }

  console.log("Composing…");
  const composed = await new FfmpegCompositionProvider().compose({
    voiceover,
    images,
    context: {
      width: 1920,
      height: 1080,
      fps: 30,
      outputPath: `${workDir}/sample.mp4`,
      workDir: `${workDir}/compose`,
      kenBurns: true,
    },
  });

  for (const warning of composed.warnings) {
    console.log(`  WARN ${warning.segmentId ?? ""} ${warning.code}: ${warning.message.slice(0, 100)}`);
  }
  console.log(
    `\n${composed.videoPath}  ${composed.width}x${composed.height}  ` +
      `${composed.durationSeconds.toFixed(1)}s  ${(composed.metadata.sizeBytes / 1_000_000).toFixed(1)}MB`,
  );
  console.log(`Images cost roughly $${(made * 0.02).toFixed(2)}.`);
  if (sources.citations.length > 0) console.log(`Sources: ${sources.citations.join(", ")}`);
}

main().catch((error: unknown) => {
  console.error("sample failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
