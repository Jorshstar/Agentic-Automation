/**
 * Delivery demo — sends the most recent finished video to Telegram.
 *
 * Use it to test your bot setup: it finds the latest output/final/<...>/video.mp4
 * and DMs it (with the manifest) to your chat. Needs TELEGRAM_BOT_TOKEN and
 * TELEGRAM_CHAT_ID in .env.
 *
 *   npm run demo:deliver
 */
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { TelegramDeliveryProvider } from "../providers/delivery/index.js";
import { logger } from "../lib/logger.js";

try {
  process.loadEnvFile();
} catch {
  // No .env — fall back to the ambient environment.
}

/** Find the most recently modified output/final/<run>/ directory. */
async function latestRunDir(): Promise<string | undefined> {
  const root = "output/final";
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return undefined;
  }
  let newest: { path: string; mtime: number } | undefined;
  for (const entry of entries) {
    const path = join(root, entry);
    try {
      const info = await stat(path);
      if (info.isDirectory() && (!newest || info.mtimeMs > newest.mtime)) {
        newest = { path, mtime: info.mtimeMs };
      }
    } catch {
      // skip unreadable entries
    }
  }
  return newest?.path;
}

async function main(): Promise<void> {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    logger.warn("Skipping delivery demo — set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env.");
    return;
  }

  const runDir = await latestRunDir();
  if (!runDir) {
    logger.warn("No finished video found under output/final/. Run `npm run demo:studio` first.");
    return;
  }

  console.log(`Delivering: ${runDir}`);
  const result = await new TelegramDeliveryProvider().deliver({
    videoPath: join(runDir, "video.mp4"),
    caption: "🎬 Test delivery from your Daily Studio bot — if you can see this video, delivery works.",
    documents: [join(runDir, "manifest.json")],
  });

  console.log(`\ndelivered: ${result.delivered}  videoSent: ${result.videoSent}  documents: ${result.documentsSent}`);
  for (const warning of result.warnings) {
    console.log(` ! [${warning.code}] ${warning.message}`);
  }
  if (result.delivered) {
    console.log("\n✓ Check your Telegram — the video should be there.");
  }
}

main().catch((error: unknown) => {
  logger.error("Delivery demo failed", { error: String(error) });
  process.exitCode = 1;
});
