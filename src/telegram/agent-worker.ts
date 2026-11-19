/**
 * LOCAL TELEGRAM AGENT — runs the chat brain on this machine.
 *
 *   npm run studio:agent
 *
 * Use this when the cloud `telegram-ingest` schedule is not deployed (or is
 * paused) and you want the bot to actually answer. It drives the SAME loop the
 * cloud task does, so behaviour is identical.
 *
 * ⚠️ Telegram allows only ONE consumer of a bot's updates. Running this while
 * the cloud schedule is live makes the two steal each other's messages, which
 * looks like the bot randomly ignoring you. Run one or the other, never both.
 */
import { runAgentTick } from "./agent-loop.js";
import { logger } from "../lib/logger.js";

try {
  process.loadEnvFile();
} catch {
  /* ambient env */
}

/** Telegram's getUpdates is a poll; once a second is responsive and cheap. */
const POLL_INTERVAL_MS = 1000;

async function main(): Promise<void> {
  console.log("🤖 Telegram agent running locally — say something to the bot. (Ctrl+C to stop)");
  console.warn(
    "⚠️  Do not run this while the cloud `telegram-ingest` schedule is active: " +
      "Telegram allows only one consumer and they will steal each other's messages.\n",
  );

  for (;;) {
    try {
      const result = await runAgentTick();
      if (result.processed > 0) {
        console.log(`   handled ${result.processed} update(s), ${result.builds} job(s) started`);
      }
    } catch (error) {
      // Never let one bad tick kill the worker — a transient network blip or a
      // provider hiccup should cost one message, not the session.
      logger.error("agent tick failed", { error: String(error) });
      console.error(`   tick failed: ${error instanceof Error ? error.message.slice(0, 200) : error}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error: unknown) => {
  logger.error("Telegram agent crashed", { error: String(error) });
  process.exitCode = 1;
});
