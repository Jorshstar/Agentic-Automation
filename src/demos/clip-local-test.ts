/**
 * Local validation for the clip automation without a full network chain:
 *  A) render a real clip (9:16 reframe + word-karaoke caption burn) from a
 *     synthetic 16:9 source, and verify the output is 1080x1920 with audio;
 *  B) smoke-test yt-dlp metadata fetch (proves the download provider's invocation).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { renderClip } from "../clip/render-clip.js";
import { probeSource } from "../clip/source-download.js";
import { probeJson } from "../lib/media.js";
import { resolveMediaTool } from "../lib/binaries.js";
import type { TranscriptWord } from "../clip/transcribe.js";

const execFileAsync = promisify(execFile);

try {
  process.loadEnvFile();
} catch {
  /* ambient */
}

async function main(): Promise<void> {
  const dir = "output/cliptest";
  await mkdir(dir, { recursive: true });

  // --- A) synthetic 16:9 source (color video + tone), then render one clip ---
  const src = join(dir, "src.mp4");
  await execFileAsync(await resolveMediaTool("ffmpeg"), [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "color=c=0x203040:s=1280x720:d=16",
    "-f", "lavfi", "-i", "sine=frequency=320:duration=16",
    "-shortest", "-pix_fmt", "yuv420p", src,
  ]);

  const sentence = "this is a live test of the clip renderer reframing and karaoke captions".split(" ");
  const words: TranscriptWord[] = sentence.map((w, i) => ({ word: w, start: 2 + i * 0.6, end: 2 + i * 0.6 + 0.55 }));

  const out = join(dir, "clip-1.mp4");
  const render = await renderClip({
    sourcePath: src,
    startSecond: 1,
    endSecond: 13,
    words,
    outPath: out,
    assPath: join(dir, "clip-1.ass"),
  });
  console.log("render.ok:", render.ok, render.ok ? "" : render.stderr.slice(0, 400));

  const probe = (await probeJson(out)) as { streams?: { codec_type?: string; width?: number; height?: number }[]; format?: { duration?: string } } | undefined;
  const v = probe?.streams?.find((s) => s.codec_type === "video");
  const a = probe?.streams?.find((s) => s.codec_type === "audio");
  console.log(`output: ${v?.width}x${v?.height}, audio=${a ? "yes" : "no"}, duration=${probe?.format?.duration}s`);
  const dimsOk = v?.width === 1080 && v?.height === 1920;
  console.log("A) RENDER:", dimsOk && render.ok && a ? "PASS" : "FAIL");

  // --- B) yt-dlp metadata smoke (short, stable public video) ---
  try {
    const info = await probeSource("https://www.youtube.com/watch?v=aqz-KE-bpKQ");
    console.log(`B) yt-dlp: PASS — got "${(info.title ?? "").slice(0, 60)}" (${info.duration}s)`);
  } catch (e) {
    console.log("B) yt-dlp: FAIL —", e instanceof Error ? e.message.slice(0, 200) : String(e));
  }
}

main().catch((e: unknown) => {
  console.error("clip-local-test failed:", e);
  process.exitCode = 1;
});
