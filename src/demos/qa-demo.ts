/**
 * QA demo — production stage 6 (validate the render).
 *
 * Probes the rendered MP4 with ffprobe and runs the QA checklist. It runs TWICE:
 * once with correct expectations (should PASS) and once with deliberately wrong
 * expectations (should FAIL) — proving QA actually catches a bad render.
 *
 *   npm run demo:qa
 */
import { FfprobeQaProvider } from "../providers/quality-assurance/index.js";
import type { QaReport } from "../providers/quality-assurance/index.js";
import { buildQaContext, DEFAULT_RUN_SETTINGS } from "../config/niche-context.js";
import { isFfprobeAvailable, probeDurationSeconds } from "../lib/media.js";
import { logger } from "../lib/logger.js";

const VIDEO = "output/video/scary-stories.mp4";

function symbol(status: string): string {
  return status === "pass" ? "✓" : status === "warn" ? "!" : "✗";
}

function printReport(title: string, report: QaReport): void {
  const overall = report.status.toUpperCase();
  console.log(`\n=== ${title}: ${overall} (${report.passed ? "publishable" : "blocked"}) ===`);
  console.log(
    `probe: ${report.probe.width}x${report.probe.height}, ${report.probe.durationSeconds}s, ` +
      `${(report.probe.sizeBytes / 1024 / 1024).toFixed(2)} MB, ${report.probe.videoCodec}/${report.probe.audioCodec}`,
  );
  for (const check of report.checks) {
    console.log(`  ${symbol(check.status)} ${check.label.padEnd(28)} ${check.detail}`);
  }
  console.log(`  → ${report.metadata.errorCount} error(s), ${report.metadata.warningCount} warning(s)`);
}

async function main(): Promise<void> {
  if (!(await isFfprobeAvailable())) {
    logger.warn("Skipping QA demo — ffprobe not found on PATH.");
    return;
  }

  const duration = await probeDurationSeconds(VIDEO);

  // 1. Correct expectations (1080x1920, real duration) → should PASS.
  const good = new FfprobeQaProvider(buildQaContext(DEFAULT_RUN_SETTINGS, duration));
  printReport("Correct expectations", await good.review({ videoPath: VIDEO }));

  // 2. Wrong expectations (expect 720x1280) → should FAIL on dimensions.
  const bad = new FfprobeQaProvider({
    expectedWidth: 720,
    expectedHeight: 1280,
    expectedDurationSeconds: 5,
    durationTolerance: 0.15,
    requireAudio: true,
    minSizeBytes: 50_000,
  });
  printReport("Wrong expectations", await bad.review({ videoPath: VIDEO }));

  console.log("\n(QA is read-only — it inspects the file, it never edits it.)");
}

main().catch((error: unknown) => {
  logger.error("QA demo failed", { error: String(error) });
  process.exitCode = 1;
});
