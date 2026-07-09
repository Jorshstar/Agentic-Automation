/**
 * Studio Telegram listener — your phone becomes the studio's remote control.
 *
 *   npm run studio:listen
 *
 * Long-polls your bot for messages, understands them (create/preview/status/
 * help), and drives the Brief Engine — with confirmation before any spend, live
 * progress edits, delivery of the finished package, and failure alerts.
 *
 * SECURITY: only TELEGRAM_CHAT_ID may command the studio; all other chats are
 * ignored. Old messages are dropped at startup so a restart never replays
 * commands. Runs on this PC (keep it open); needs the usual .env keys.
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
  const telegram = new TelegramClient();
  const controller = new StudioTelegramController(telegram);

  let offset = await telegram.dropBacklog();
  await telegram.send("🎛 Studio online — tell me what to make. (say \"help\" for examples)");
  console.log("Listening for Telegram commands... (Ctrl+C to stop)");

  for (;;) {
    const messages = await telegram.poll(offset);
    for (const message of messages) {
      offset = Math.max(offset, message.updateId + 1);
      if (message.text === "") {
        continue; // non-text update, already consumed
      }
      if (message.chatId !== telegram.ownerChatId) {
        console.log(`ignored message from unauthorized chat ${message.chatId}`);
        continue;
      }
      console.log(`⇐ ${message.from}: ${message.text}`);
      await controller.handle(message.text);
    }
  }
}

main().catch((error: unknown) => {
  logger.error("Listener crashed", { error: String(error) });
  process.exitCode = 1;
});
