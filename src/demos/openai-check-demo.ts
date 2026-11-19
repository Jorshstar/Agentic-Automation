/**
 * Confirms the OpenAI account actually WORKS: the key authenticates, the models
 * the clip pipeline needs are reachable, and — the part a key check alone never
 * proves — the account has credit.
 *
 *   npm run clip:check
 *
 * An authenticating key with an empty balance passes every offline check and
 * then fails mid-job with a 429, so this spends a few tokens on purpose.
 */
import { OpenAIProviderClient } from "../ai/providers/openai/index.js";

try {
  process.loadEnvFile();
} catch {
  /* ambient env */
}

const NEEDED = ["whisper-1", "gpt-4o", "gpt-4o-mini"] as const;

async function main(): Promise<void> {
  const key = process.env.OPENAI_API_KEY;
  if (!key || key.trim() === "") {
    console.error("❌ OPENAI_API_KEY is not set.");
    process.exitCode = 1;
    return;
  }
  // Length and last four only — never the value itself.
  console.log(`key      : ${key.length} chars, ends ...${key.slice(-4)}`);

  const listing = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(30_000),
  });
  console.log(`auth     : HTTP ${listing.status}`);
  if (!listing.ok) {
    console.error(`❌ ${(await listing.text()).slice(0, 200)}`);
    process.exitCode = 1;
    return;
  }
  const available = new Set(
    ((await listing.json()) as { data?: { id?: string }[] }).data?.map((m) => m.id ?? "") ?? [],
  );
  for (const model of NEEDED) {
    console.log(`  ${model.padEnd(13)} ${available.has(model) ? "✅" : "❌ not available"}`);
  }

  // The real test: a billing failure only shows up on an actual completion.
  try {
    const result = await new OpenAIProviderClient().generate({
      userPrompt: 'Reply with this JSON exactly: {"ok":true}',
      temperature: 0,
      maxTokens: 20,
      expectedOutput: "json",
      model: "gpt-4o-mini",
      provider: "openai",
    });
    console.log(`completion: ${result.content.trim()} (${result.usage.totalTokens} tokens, ${result.latencyMs}ms)`);
    console.log("\n✅ Account works and has credit — the clip pipeline can run.");
  } catch (error) {
    const code = (error as { code?: string }).code ?? "UNKNOWN";
    console.error(`\n❌ ${code}: ${error instanceof Error ? error.message.slice(0, 300) : String(error)}`);
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error("check failed:", error);
  process.exitCode = 1;
});
