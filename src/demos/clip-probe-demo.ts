/**
 * Metadata-only probe of a source link: title, duration, chapters, and whether
 * the platform offers auto-captions. Costs nothing and downloads nothing — use
 * it to size a clip job before paying to pull the video.
 *
 *   npx tsx src/demos/clip-probe-demo.ts "<url>"
 */
import { probeSource, fetchAutoCaptions } from "../clip/source-download.js";

try {
  process.loadEnvFile();
} catch {
  /* ambient env */
}

async function main(): Promise<void> {
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: tsx src/demos/clip-probe-demo.ts "<url>"');
    process.exitCode = 1;
    return;
  }
  const info = await probeSource(url, "output/probe");
  const duration = typeof info.duration === "number" ? info.duration : 0;
  console.log(`title    : ${info.title ?? "?"}`);
  console.log(`duration : ${Math.floor(duration / 60)}m ${Math.round(duration % 60)}s`);
  console.log(`chapters : ${info.chapters?.length ?? 0}`);

  const captions = await fetchAutoCaptions(url, "output/probe/subs");
  console.log(
    captions
      ? `captions : ${captions.length} lines (FREE selection path available)`
      : "captions : none — a full Whisper pass would be needed",
  );
  if (captions) console.log(`sample   : ${captions.slice(0, 3).map((c) => c.text).join(" / ")}`);
}

main().catch((error: unknown) => {
  console.error("probe failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
