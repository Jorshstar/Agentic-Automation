import { join } from "node:path";
import { createClipQueue } from "./clip-queue.js";
import { runClipJob } from "./run-clip-job.js";
import { TelegramClient } from "../telegram/telegram-client.js";
import { logger } from "../lib/logger.js";

/**
 * LOCAL CLIP WORKER — run this on your PC to process clip jobs.
 *
 *   npm run studio:clip-worker
 *
 * The cloud Telegram agent queues clip requests; this worker (on your home IP,
 * which YouTube trusts) drains the queue, downloads + clips the video, and
 * delivers to Telegram. Keep it running while you want clipping to work; jobs
 * queued while it's off are picked up when it starts. Needs yt-dlp on PATH (or
 * YT_DLP_PATH) plus the usual .env keys.
 */

try {
  process.loadEnvFile();
} catch {
  // fall back to ambient env
}

const POLL_INTERVAL_MS = 5000;

async function main(): Promise<void> {
  const queue = createClipQueue();
  const telegram = new TelegramClient();

  await telegram.send("🎬 Clip worker online — send me a video link to clip.");
  console.log("Clip worker running... (Ctrl+C to stop)");

  for (;;) {
    let job;
    try {
      job = await queue.dequeue();
    } catch (error) {
      logger.error("clip queue read failed", { error: String(error) });
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    if (!job) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    console.log(`⇐ clip job: ${job.url} (theme: ${job.theme})`);
    const workDir = join("output", "clips", `local-${Date.now()}`);
    try {
      const result = await runClipJob(job, {
        workDir,
        onStep: (message) => {
          console.log("  " + message);
          void telegram.send(message);
        },
      });
      if (result.delivered > 0) {
        // Show the scores so the user can tell a near-certain pick from a
        // marginal one without opening every clip.
        const scores = result.clips
          .filter((clip) => clip.delivered)
          .map((clip) => `${clip.score}`)
          .join(", ");
        await telegram.send(
          `✅ Sent ${result.delivered} clip(s) from "${result.title.slice(0, 70)}" ` +
            `(scores: ${scores}/100). Want more, or a different angle?`,
        );
      } else {
        await telegram.send("❌ Couldn't produce clips from that one.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 400) : String(error);
      console.error("clip job failed:", message);
      await telegram.send(`❌ Clip job failed:\n${message}`);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error: unknown) => {
  logger.error("Clip worker crashed", { error: String(error) });
  process.exitCode = 1;
});
