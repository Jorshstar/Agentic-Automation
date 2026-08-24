/**
 * Local validation for the Telegram-upload path: proves user-supplied photos are
 * placed on scenes and flow all the way through composition + QA. Feeds ENOUGH
 * images to cover every scene, so no OpenAI image generation is paid — this
 * tests the injection + compose + QA plumbing cheaply, not the AI-fill.
 *
 *   npm run demo:upload-inject
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { resolveBrief, runResolvedBrief } from "../studio/content-brief.js";

try {
  process.loadEnvFile();
} catch {
  // fall back to ambient env
}

const IMG_DIR =
  process.env.UPLOAD_TEST_DIR ??
  "C:/Users/hp/AppData/Local/Temp/claude/c--Users-hp-Desktop-agentic-automation/d3c5611f-69f8-445a-ba6f-6a8c4b3b1920/scratchpad/uptest";

async function main(): Promise<void> {
  const photos = readdirSync(IMG_DIR)
    .filter((f) => f.endsWith(".jpg"))
    .sort()
    .map((f) => ({ path: join(IMG_DIR, f), kind: "photo" as const }));

  console.log(`Feeding ${photos.length} user photos as scene visuals (should cover all scenes).`);

  const resolved = await resolveBrief({
    instructions: "A short upbeat vertical montage introducing my brand from these photos.",
    durationSeconds: 45,
  });
  const noStock = { ...resolved, run: { ...resolved.run, useStockVideo: false } };

  const result = await runResolvedBrief(noStock, {
    userAssets: photos,
    onStep: (m) => console.log(m),
  });

  console.log("\n==== RESULT ====");
  console.log("runId:", result.runId);
  console.log("title:", result.topic.title);
  console.log("scenes:", result.segmentCount, "duration:", result.durationSeconds, "s");
  console.log("images generated (AI):", result.imagesGenerated, "(0 = all covered by user photos)");
  console.log("QA:", result.qa.status, "passed:", result.qa.passed);
  console.log("video:", result.videoPath);
  console.log("cost $", result.costUsd);
}

main().catch((error: unknown) => {
  console.error("upload-inject demo failed:", error);
  process.exitCode = 1;
});
