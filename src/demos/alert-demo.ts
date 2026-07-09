/**
 * Alert demo — verifies failure alerts actually reach your Telegram.
 *
 * Sends one test alert through the same `notify()` path the daily task uses for
 * "run failed" / "QA blocked" messages. If this lands in your chat, real alerts
 * will too. Needs TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID.
 *
 *   npm run demo:alert
 */
import { TelegramDeliveryProvider } from "../providers/delivery/index.js";
import { logger } from "../lib/logger.js";

try {
  process.loadEnvFile();
} catch {
  // No .env — fall back to the ambient environment.
}

async function main(): Promise<void> {
  const sent = await new TelegramDeliveryProvider().notify(
    "🧪 Test alert from your Content Studio — if you can read this, failure alerts and QA-block alerts will reach you.",
  );
  console.log(sent ? "✓ Alert delivered — check your Telegram." : "✗ Alert NOT delivered (bot not configured or send failed).");
  if (!sent) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  logger.error("Alert demo failed", { error: String(error) });
  process.exitCode = 1;
});
