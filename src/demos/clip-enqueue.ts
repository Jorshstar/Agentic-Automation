import { createClipQueue } from "../clip/clip-queue.js";

try {
  process.loadEnvFile();
} catch {
  /* ambient */
}

async function main(): Promise<void> {
  const queue = createClipQueue();
  const url = process.argv[2] ?? "https://youtu.be/EiYn6IQ6Zvw";
  const theme = process.argv[3] ?? "auto";
  const count = Number.parseInt(process.argv[4] ?? "2", 10);
  const ok = await queue.enqueue({ url, theme, count });
  console.log(`enqueued: ${ok} — ${url} (${theme}, ${count}); queue size now ${await queue.size()}`);
}

main().catch((e: unknown) => {
  console.error("enqueue failed:", e);
  process.exitCode = 1;
});
