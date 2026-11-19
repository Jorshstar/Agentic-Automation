/**
 * Exercises the Telegram chat brain WITHOUT Telegram — no bot, no polling, no
 * messages sent. Useful because the agent swallows its own errors and answers
 * with a generic fallback, so a broken provider looks identical to a quiet one
 * from the chat side.
 *
 *   npm run studio:agent:test
 *   npm run studio:agent:test -- "clip the goals from https://youtu.be/XXXX full screen"
 */
import { TelegramAgentProvider } from "../providers/telegram-agent/index.js";

try {
  process.loadEnvFile();
} catch {
  /* ambient env */
}

const CONVERSATIONS: readonly (readonly string[])[] = [
  ["Hi"],
  ["clip the goals from https://youtu.be/Z0LEwAutI3c"],
  ["clip the key insights from https://youtu.be/Z0LEwAutI3c but show the whole video"],
  ["clip the funniest moments from https://youtu.be/Z0LEwAutI3c, full screen like tiktok"],
];

async function main(): Promise<void> {
  const custom = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
  const conversations = custom.length > 0 ? [custom] : CONVERSATIONS;
  const agent = new TelegramAgentProvider();

  for (const messages of conversations) {
    console.log(`\n── user: ${messages.join(" / ")}`);
    const decision = await agent.respond({
      messages: messages.map((text) => ({ role: "user" as const, text })),
      assetCount: 0,
    });
    console.log(`   reply : ${decision.reply.slice(0, 160)}`);
    console.log(
      `   action: ${decision.action}` +
        (decision.action === "clip"
          ? `  theme="${decision.theme}" count=${decision.count} layout="${decision.layout}" url=${decision.url || "(upload)"}`
          : ""),
    );
  }
}

main().catch((error: unknown) => {
  console.error("agent test failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
