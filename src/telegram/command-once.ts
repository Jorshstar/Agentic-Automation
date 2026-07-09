/**
 * One-shot command test — feeds a single message through the SAME controller the
 * listener uses, without polling Telegram. Replies still go to your Telegram, so
 * you can verify the whole chain from the terminal:
 *
 *   npm run studio:command -- "preview a cozy rainy-day jazz study channel"
 *   npm run studio:command -- "yes"   ← note: pending state does NOT persist
 *                                       between invocations; use studio:listen
 *                                       for the real conversational flow.
 */
import { TelegramClient } from "./telegram-client.js";
import { StudioTelegramController } from "./controller.js";
import { logger } from "../lib/logger.js";

try {
  process.loadEnvFile();
} catch {
  // No .env — fall back to the ambient environment.
}

async function main(): Promise<void> {
  const text = process.argv.slice(2).join(" ").trim();
  if (text === "") {
    console.error('✗ Give me a message, e.g.: npm run studio:command -- "help"');
    process.exit(1);
  }

  const telegram = new TelegramClient();
  const controller = new StudioTelegramController(telegram);

  console.log(`⇐ (terminal): ${text}`);
  await controller.handle(text);

  // If the message started a run, wait for the queue to drain before exiting.
  while (controller.busy) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  console.log("done — check your Telegram for the reply.");
}

main().catch((error: unknown) => {
  logger.error("Command failed", { error: String(error) });
  process.exitCode = 1;
});
