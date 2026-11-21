/**
 * Runs the WHOLE clip pipeline locally and delivers the clips to Telegram —
 * the exact code path the clip-video cloud task takes, so what you see here is
 * what production does.
 *
 *   npm run clip -- "<url-or-file>" "<theme>" <count> [reframe] [preset] [--no-send]
 *
 * Examples:
 *   npm run clip -- "https://youtu.be/XXXX" "the goals" 5
 *   npm run clip -- "./output/match.mp4" "funny moments" 3
 *   npm run clip -- "https://youtu.be/XXXX" "emotional" 4 fit clean-white
 *
 * Pass --no-send to render without sending anything to Telegram — use that
 * while tuning, so testing does not flood the chat.
 * Pass --clean to erase the original poster's burned-in title card/watermark.
 * Pass --captions to burn subtitles and a title card (off by default).
 * Pass --tighten to cut the pauses out (off by default).
 *
 * Note: this used to cache the download and transcript in a fixed directory.
 * That cache was keyed on the directory alone, so a second run with a DIFFERENT
 * url silently reused the first video's transcript. Each run now gets its own
 * directory under output/cliprun/.
 */
import { runClipJob } from "../clip/run-clip-job.js";
import type { CaptionPresetName } from "../clip/captions.js";

try {
  process.loadEnvFile();
} catch {
  /* ambient env */
}

async function main(): Promise<void> {
  const flags = process.argv.filter((argument) => argument.startsWith("--"));
  const positional = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
  const deliver = !flags.includes("--no-send");
  const removeOverlays = flags.includes("--clean");
  const captions = flags.includes("--captions");
  const tighten = flags.includes("--tighten");

  const input = positional[0];
  if (!input) {
    console.error(
      'Usage: npm run clip -- "<url-or-file>" "<theme>" <count> [reframe] [preset] [--no-send]',
    );
    process.exitCode = 1;
    return;
  }
  const theme = positional[1] ?? "auto";
  const count = Number.parseInt(positional[2] ?? "4", 10);
  const reframe = positional[3];
  const captionPreset = positional[4] as CaptionPresetName | undefined;

  const workDir = `output/cliprun/${Date.now()}`;
  const started = Date.now();

  const result = await runClipJob(
    { url: input, theme, count, reframe, captionPreset, removeOverlays, captions, tighten },
    { workDir, deliver, onStep: (message) => console.log(message) },
  );

  const seconds = Math.round((Date.now() - started) / 1000);
  console.log(`\n── ${result.title} ──`);
  for (const [index, clip] of result.clips.entries()) {
    console.log(
      `${index + 1}. [${fmt(clip.startSecond)}-${fmt(clip.endSecond)}] ${clip.score}/100  ${clip.hook}` +
        `${clip.evidence.length > 0 ? `  (${clip.evidence.join(", ")})` : ""}`,
    );
  }
  if (result.compilationPath) {
    console.log(`\n🎬 joined into one video: ${result.compilationPath}`);
  }
  console.log(
    `\n${deliver ? `✅ delivered ${result.delivered}/${result.found}` : `📁 rendered ${result.clips.length}`}` +
      ` clips in ${seconds}s · ${result.transcribedMinutes} min transcribed · files in ${workDir}`,
  );
}

function fmt(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
}

main().catch((error: unknown) => {
  console.error("clip-run failed:", error);
  process.exitCode = 1;
});
