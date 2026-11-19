/**
 * Renders the SAME moment in every layout and caption preset, so you can look at
 * them side by side and pick. No downloads, no AI calls, no delivery — just the
 * render stage, which is the part you judge with your eyes.
 *
 *   npx tsx src/demos/clip-render-demo.ts <video> [startSecond] [lengthSeconds]
 *
 * It also doubles as the render smoke test: every layout, tightening on and off,
 * and a captionless clip all go through real ffmpeg and are then probed. Any
 * filtergraph mistake shows up here instead of in a delivered clip.
 */
import { renderClip } from "../clip/render-clip.js";
import { checkClip, describeIssues } from "../clip/qa.js";
import type { ReframePlan } from "../clip/reframe.js";
import type { TranscriptWord } from "../clip/transcribe.js";
import type { CaptionPresetName } from "../clip/captions.js";
import { probeJson } from "../lib/media.js";

try {
  process.loadEnvFile();
} catch {
  /* ambient env */
}

interface Variant {
  readonly name: string;
  readonly reframe: ReframePlan;
  readonly preset: CaptionPresetName;
  readonly tighten: boolean;
  readonly captions: boolean;
}

/**
 * Stand-in word timings when the source has no transcript: dense speech with a
 * long silent gap and a filler word, which is exactly what tightening targets.
 */
function syntheticWords(lengthSeconds: number): TranscriptWord[] {
  const words: TranscriptWord[] = [];
  const half = lengthSeconds / 2;
  for (let t = 0; t < half - 1; t += 0.4) {
    words.push({ word: `word${Math.round(t * 10)}`, start: t, end: t + 0.35 });
  }
  words.push({ word: "um", start: half - 0.8, end: half - 0.3 });
  for (let t = half + 2.5; t < lengthSeconds - 0.5; t += 0.4) {
    words.push({ word: `tail${Math.round(t * 10)}`, start: t, end: t + 0.35 });
  }
  return words;
}

async function dimensions(path: string): Promise<{ width: number; height: number }> {
  const json = (await probeJson(path)) as
    | { streams?: { codec_type?: string; width?: number; height?: number }[] }
    | undefined;
  const video = json?.streams?.find((stream) => stream.codec_type === "video");
  return { width: video?.width ?? 1920, height: video?.height ?? 1080 };
}

async function main(): Promise<void> {
  const source = process.argv[2];
  if (!source) {
    console.error("Usage: tsx src/demos/clip-render-demo.ts <video> [startSecond] [lengthSeconds]");
    process.exitCode = 1;
    return;
  }
  const startSecond = Number(process.argv[3] ?? 2);
  const lengthSeconds = Number(process.argv[4] ?? 18);
  const { width, height } = await dimensions(source);
  const outDir = `output/clip-layouts/${Date.now()}`;

  const crop = (note: string, keyframes: ReframePlan["keyframes"]): ReframePlan => ({
    kind: "crop",
    sourceWidth: width,
    sourceHeight: height,
    keyframes,
    note,
  });

  const variants: Variant[] = [
    { name: "native", reframe: { kind: "native", keyframes: [], note: "original" }, preset: "bold-yellow", tighten: false, captions: true },
    { name: "fit", reframe: { kind: "fit", keyframes: [], note: "fit" }, preset: "bold-yellow", tighten: false, captions: true },
    { name: "fit-top", reframe: { kind: "fit-top", keyframes: [], note: "fit-top" }, preset: "impact-red", tighten: false, captions: true },
    { name: "crop-static", reframe: crop("static", [{ second: 0, xCenter: 0.35 }]), preset: "bold-yellow", tighten: false, captions: true },
    {
      name: "crop-pan",
      reframe: crop("pan", [
        { second: 0, xCenter: 0.2 },
        { second: lengthSeconds / 2, xCenter: 0.8 },
        { second: lengthSeconds, xCenter: 0.4 },
      ]),
      preset: "clean-white",
      tighten: false,
      captions: true,
    },
    { name: "crop-tightened", reframe: crop("pan", [{ second: 0, xCenter: 0.5 }]), preset: "bold-yellow", tighten: true, captions: true },
    { name: "passthrough", reframe: { kind: "passthrough", sourceWidth: width, sourceHeight: height, keyframes: [], note: "as-is" }, preset: "clean-white", tighten: false, captions: true },
    { name: "no-captions", reframe: { kind: "fit", keyframes: [], note: "fit" }, preset: "bold-yellow", tighten: false, captions: false },
  ];

  const words = syntheticWords(lengthSeconds);
  let failures = 0;

  for (const variant of variants) {
    const outPath = `${outDir}/${variant.name}.mp4`;
    const result = await renderClip({
      sourcePath: source,
      startSecond,
      endSecond: startSecond + lengthSeconds,
      words: variant.captions ? words : [],
      outPath,
      assPath: `${outDir}/${variant.name}.ass`,
      reframe: variant.reframe,
      captionPreset: variant.preset,
      hook: variant.captions ? "He scored from the halfway line" : undefined,
      tighten: variant.tighten,
    });

    if (!result.ok) {
      failures++;
      console.log(`❌ ${variant.name.padEnd(16)} ffmpeg failed\n   ${result.stderr.slice(0, 400)}`);
      continue;
    }

    const qa = await checkClip(outPath, {
      seconds: result.durationSeconds,
      width: result.width,
      height: result.height,
    });
    if (!qa.ok) failures++;
    console.log(
      `${qa.ok ? "✅" : "❌"} ${variant.name.padEnd(16)} ${qa.width}x${qa.height} ` +
        `${qa.durationSeconds?.toFixed(2)}s (expected ${result.durationSeconds.toFixed(2)}s)` +
        `${qa.ok ? "" : ` — ${describeIssues(qa.issues)}`}`,
    );
  }

  console.log(failures === 0 ? `\n✅ all layouts rendered — ${outDir}` : `\n❌ ${failures} failure(s)`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error: unknown) => {
  console.error("layout demo failed:", error);
  process.exitCode = 1;
});
