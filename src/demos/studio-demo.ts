/**
 * Studio demo — the FINALE: one command → a complete, QA'd faceless video.
 *
 * Runs the whole pipeline for a niche (auto-topic unless you pass one):
 *   topic → research → content plan → narration → scene images + voice
 *         → captions → music → composition → QA → export
 *
 * Usage:
 *   npm run demo:studio                          (scary-stories, auto topic)
 *   npm run demo:studio -- tech-news             (a niche, auto topic)
 *   npm run demo:studio -- scary-stories "The last voicemail"   (explicit topic)
 *   npm run demo:studio -- --resume <runId>      (resume a failed/finished run —
 *                                                 completed stages are NOT re-paid)
 *
 * Requires OPENAI_API_KEY (voice + images) and ffmpeg on PATH. A full run makes
 * ~8-12 images (~$0.30-0.60) and takes ~4-6 minutes.
 */
import { runStudio } from "../studio/run-studio.js";
import type { StudioResult } from "../studio/run-studio.js";
import { loadResolvedBrief, runResolvedBrief } from "../studio/content-brief.js";
import { StudioStageError } from "../studio/run-ledger.js";
import { NICHE_PROFILES } from "../config/niche-profiles.js";
import { isFfprobeAvailable } from "../lib/media.js";
import type { Niche } from "../types/index.js";
import { logger } from "../lib/logger.js";

try {
  process.loadEnvFile();
} catch {
  // No .env — fall back to the ambient environment.
}

function parseNiche(value: string | undefined): Niche {
  if (value === undefined) {
    return "scary-stories";
  }
  if (value in NICHE_PROFILES) {
    return value as Niche;
  }
  // FAIL LOUDLY. Silently defaulting here once turned a mistyped --resume
  // invocation into a full paid run — never guess when money is involved.
  console.error(`✗ Unknown niche "${value}". Valid niches: ${Object.keys(NICHE_PROFILES).join(", ")}`);
  console.error(`  (To resume a run, use: npm run demo:studio -- --resume <runId>)`);
  return process.exit(1);
}

async function main(): Promise<void> {
  if (!(await isFfprobeAvailable())) {
    logger.warn("Skipping studio run — ffmpeg/ffprobe not found on PATH.");
    return;
  }
  if (!process.env.OPENAI_API_KEY) {
    logger.warn("Skipping studio run — set OPENAI_API_KEY (needed for voice + images).");
    return;
  }

  // Args: [niche] [topic] | --resume <runId> | <runId>
  const args = process.argv.slice(2);
  const resumeIndex = args.indexOf("--resume");
  let resumeRunId = resumeIndex >= 0 ? args[resumeIndex + 1] : undefined;
  let positional =
    resumeIndex >= 0 ? args.filter((_, i) => i !== resumeIndex && i !== resumeIndex + 1) : args;

  // `npm run x -- --resume <id>` can lose the flag to npm's own arg parsing, so
  // ALSO recognise a bare runId (niche-timestamp shape) as a resume request.
  if (resumeRunId === undefined && positional[0] && /-\d{4}-\d{2}-\d{2}T/u.test(positional[0])) {
    resumeRunId = positional[0];
    positional = positional.slice(1);
  }

  const startedAt = Date.now();
  let result: StudioResult;

  if (resumeRunId) {
    console.log(`\n▶ Resuming run "${resumeRunId}"\n`);
    // Brief runs (incl. "custom" identities) persist their resolved brief —
    // resume with EXACTLY that identity. Preset runs fall back to the niche
    // derived from the runId prefix.
    const savedBrief = await loadResolvedBrief(resumeRunId);
    if (savedBrief) {
      result = await runResolvedBrief(savedBrief, { resumeRunId });
    } else {
      const niche = parseNiche(resumeRunId.replace(/-\d{4}-\d{2}-\d{2}T.*$/u, ""));
      result = await runStudio({ niche, resumeRunId });
    }
  } else {
    const niche = parseNiche(positional[0]);
    const topic = positional[1];
    console.log(`\n▶ Running the studio for "${niche}"${topic ? ` — topic: "${topic}"` : " (auto topic)"}\n`);
    result = await runStudio({ niche, ...(topic ? { topic } : {}) });
  }

  console.log(`\n=== DONE in ${((Date.now() - startedAt) / 1000).toFixed(0)}s ===`);
  console.log(`Run:       ${result.runId}   cost $${result.costUsd.toFixed(2)}${result.resumedStages.length > 0 ? `   (resumed ${result.resumedStages.length} stages)` : ""}`);
  console.log(`Niche:     ${result.niche}`);
  console.log(`Title:     ${result.topic.title}`);
  console.log(`Hook:      ${result.topic.hook || "—"}`);
  console.log(`Scenes:    ${result.segmentCount}   Images: ${result.imagesGenerated}`);
  console.log(`Duration:  ${result.durationSeconds}s`);
  console.log(`QA:        ${result.qa.status.toUpperCase()} (${result.qa.passed ? "publishable" : "BLOCKED"})`);
  console.log(`YT Title:  ${result.seo.youtube.title}`);
  console.log(`Hashtags:  ${result.seo.tiktok.hashtags.join(" ")}`);
  if (result.videoPath !== "") {
    console.log(`\n🎬 Video:      ${result.videoPath}`);
  }
  console.log(`📋 Upload kit: ${result.uploadKitPath}`);
  if (result.thumbnailPath !== "") {
    console.log(`🖼️ Thumbnails: ${result.thumbnailPath} (+ wide)`);
  }
  console.log(`📄 Manifest:   ${result.manifestPath}`);
  console.log(`📁 Package:    ${result.finalDir}`);

  if (result.warnings.length > 0) {
    console.log(`\n--- Warnings (${result.warnings.length}) ---`);
    for (const warning of result.warnings.slice(0, 20)) {
      console.log(` ! ${warning}`);
    }
  }
}

main().catch((error: unknown) => {
  logger.error("Studio run failed", { error: String(error) });
  if (error instanceof StudioStageError) {
    console.log(
      `\n💡 Completed stages are checkpointed — resume without re-paying for them:\n` +
        `   npm run demo:studio -- --resume ${error.runId}`,
    );
  }
  process.exitCode = 1;
});
