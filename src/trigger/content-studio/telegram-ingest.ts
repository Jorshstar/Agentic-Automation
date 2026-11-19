import { schedules } from "@trigger.dev/sdk";
import { runAgentTick } from "../../telegram/agent-loop.js";
import { logger } from "../../lib/logger.js";

/**
 * TELEGRAM AGENT — an always-on creative partner you chat with to make videos.
 *
 * Runs every minute in Trigger cloud and is the SINGLE consumer of the bot's
 * updates. Telegram allows only one, so the local `studio:agent` worker must NOT
 * run at the same time as this schedule.
 *
 * The loop itself lives in `telegram/agent-loop.ts` so the cloud schedule and
 * the local worker run byte-identical logic; this file is only the trigger.
 *
 * SECURITY: only TELEGRAM_CHAT_ID may drive the studio; other chats are ignored
 * (their updates are still consumed so the offset advances).
 */
export const telegramIngest = schedules.task({
  id: "telegram-ingest",
  cron: "* * * * *", // every minute (Telegram getUpdates has no push; poll is fine)
  run: async (): Promise<{ processed: number; builds: number }> => {
    const result = await runAgentTick();
    if (result.processed > 0) {
      logger.info("telegram-ingest tick", { processed: result.processed, builds: result.builds });
    }
    return result;
  },
});
