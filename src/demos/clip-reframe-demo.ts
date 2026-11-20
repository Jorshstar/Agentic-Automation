/**
 * Inspect the subject-tracking used by the vertical layouts.
 *
 *   npm run clip:reframe -- <video> [startSecond] [lengthSeconds]
 *
 * Why this exists: the tracking crop is the one stage whose output cannot be
 * judged from a log line. "vision 5/7, static crop @ 0.50" reads like success
 * whether 0.50 is the speaker or the empty gap between two people — and on a
 * two-person shot it was the gap.
 *
 * So this writes, into output/reframe-check/<timestamp>/:
 *   frame-N.jpg        the frame the model was given
 *   marked-N.png       the same frame with a line drawn where it said the
 *                      subject is, and the 9:16 crop window it would use
 *   crop.mp4           the rendered tracking crop
 *   fit.mp4            the same range left whole, for comparison
 *
 * Open the marked frames: if the line is not on the speaker, the crop is wrong,
 * whatever the confidence said.
 */
import { mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { probeSubjects, planReframe, cropWidthFor } from "../clip/reframe.js";
import { renderClip } from "../clip/render-clip.js";
import { probeJson } from "../lib/media.js";
import { resolveMediaTool } from "../lib/binaries.js";

const run = promisify(execFile);

try {
  process.loadEnvFile();
} catch {
  /* ambient env */
}

async function dimensions(path: string): Promise<{ width: number; height: number }> {
  const json = (await probeJson(path)) as
    | { streams?: { codec_type?: string; width?: number; height?: number }[] }
    | undefined;
  const video = json?.streams?.find((s) => s.codec_type === "video");
  return { width: video?.width ?? 1920, height: video?.height ?? 1080 };
}

async function main(): Promise<void> {
  const source = process.argv[2];
  if (!source) {
    console.error("Usage: npm run clip:reframe -- <video> [startSecond] [lengthSeconds]");
    process.exitCode = 1;
    return;
  }
  const startSecond = Number(process.argv[3] ?? 0);
  const lengthSeconds = Number(process.argv[4] ?? 20);
  const outDir = join("output", "reframe-check", String(Date.now()));
  await mkdir(outDir, { recursive: true });

  const { width, height } = await dimensions(source);
  const cropWidth = cropWidthFor(width, height);
  const ffmpeg = await resolveMediaTool("ffmpeg");
  console.log(`source ${width}x${height}, 9:16 crop window is ${cropWidth}px wide\n`);

  const probes = await probeSubjects({
    sourcePath: source,
    startSecond,
    endSecond: startSecond + lengthSeconds,
    workDir: outDir,
    mode: "smart",
  });

  for (const [index, probe] of probes.entries()) {
    const x = probe.xCenter;
    console.log(
      `  t=${probe.localSecond.toFixed(1)}s  ` +
        (x === undefined
          ? "no answer"
          : `x=${x.toFixed(2)}  confidence=${(probe.confidence ?? 0).toFixed(2)}`),
    );
    if (x === undefined) continue;

    // Draw the claimed subject centre and the crop window that follows from it,
    // on the ACTUAL frame the model saw.
    const marked = join(outDir, `marked-${index}.png`);
    const left = Math.min(Math.max(x - cropWidth / (2 * width), 0), 1 - cropWidth / width);
    const right = left + cropWidth / width;
    await run(ffmpeg, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", probe.framePath,
      "-vf",
      [
        `drawbox=x=iw*${x.toFixed(4)}-3:y=0:w=6:h=ih:color=red@0.9:t=fill`,
        `drawbox=x=iw*${left.toFixed(4)}:y=0:w=iw*${(right - left).toFixed(4)}:h=ih:color=yellow@0.9:t=4`,
      ].join(","),
      marked,
    ]).catch(() => undefined);
  }

  const answered = probes.filter((p) => p.xCenter !== undefined);
  if (answered.length > 0) {
    const values = answered.map((p) => p.xCenter!);
    const spread = Math.max(...values) - Math.min(...values);
    console.log(
      `\n  ${answered.length}/${probes.length} answered, spread ${spread.toFixed(2)} ` +
        `(${spread < 0.05 ? "static crop" : "tracking crop"})`,
    );
  }

  // Render both so the difference is watchable, not just describable.
  for (const [name, mode] of [["crop", "smart"], ["fit", "native"]] as const) {
    const plan = await planReframe({
      sourcePath: source,
      startSecond,
      endSecond: startSecond + lengthSeconds,
      workDir: outDir,
      mode,
    });
    const result = await renderClip({
      sourcePath: source,
      startSecond,
      endSecond: startSecond + lengthSeconds,
      words: [],
      outPath: join(outDir, `${name}.mp4`),
      assPath: join(outDir, `${name}.ass`),
      reframe: plan,
    });
    console.log(`  ${name}.mp4  ${result.width}x${result.height}  ${plan.note}`);
  }

  console.log(`\nLook at ${outDir}/marked-*.png — the red line must be on the speaker.`);
}

main().catch((error: unknown) => {
  console.error("reframe check failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
