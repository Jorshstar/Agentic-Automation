/**
 * Memory demo — inspect the topic history + verify the store connection.
 *
 * Shows which backend is active (Upstash on the cloud, or the local file), pings
 * Upstash if configured, and lists the topics already remembered. Read-only — it
 * doesn't add anything.
 *
 *   npm run demo:memory
 */
import { createTopicHistoryStore } from "../studio/topic-history.js";
import { logger } from "../lib/logger.js";

try {
  process.loadEnvFile();
} catch {
  // No .env — fall back to the ambient environment.
}

async function pingUpstash(): Promise<string> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    return "not configured (using the local file store)";
  }
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(["PING"]),
    });
    if (!response.ok) {
      return `FAILED (${response.status}): ${(await response.text()).slice(0, 200)}`;
    }
    const json = (await response.json()) as { result?: unknown };
    return `OK (${JSON.stringify(json.result)})`;
  } catch (error) {
    return `ERROR: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function main(): Promise<void> {
  const store = createTopicHistoryStore();
  console.log("\n=== Topic memory ===");
  console.log("Backend:      ", store.name);
  console.log("Upstash ping: ", await pingUpstash());

  const recent = await store.recent(20);
  console.log(`\nRemembered topics (${recent.length}):`);
  if (recent.length === 0) {
    console.log("  (none yet — the first run will record one)");
  } else {
    for (const topic of recent) {
      console.log(`  - [${topic.date}] ${topic.niche}: ${topic.title}`);
    }
  }
}

main().catch((error: unknown) => {
  logger.error("Memory demo failed", { error: String(error) });
  process.exitCode = 1;
});
