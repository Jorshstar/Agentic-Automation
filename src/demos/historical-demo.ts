/**
 * Historical research demo — the scary-stories research agent, alone.
 *
 * Runs ONLY the research stage: the agent picks a real historical event
 * (rotating country + era against memory), verifies it with live web search, and
 * prints the structured package. No images, no voice, no video.
 *
 *   npm run demo:historical
 *   npm run demo:historical -- "The Dyatlov Pass incident"   (research a given event)
 */
import { createClaudeAIKernel } from "../ai/index.js";
import { ClaudeResearchProvider } from "../providers/research/index.js";
import { createTopicHistoryStore, recentCountries, recentEras } from "../studio/topic-history.js";
import { getNicheProfile } from "../config/niche-profiles.js";
import { buildResearchContext } from "../config/niche-context.js";
import { webSearchCostUsd, claudeCostUsd } from "../config/pricing.js";
import { logger } from "../lib/logger.js";

try {
  process.loadEnvFile();
} catch {
  // No .env — fall back to the ambient environment.
}

async function main(): Promise<void> {
  const assigned = process.argv.slice(2).join(" ").trim();

  const history = createTopicHistoryStore();
  const past = await history.recent(40);
  const bannedCountries = recentCountries(past, 6);
  const bannedEras = recentEras(past, 3);

  console.log(`\n▶ Historical research${assigned ? `: "${assigned}"` : " (agent picks the event)"}`);
  console.log(`  banned countries: ${bannedCountries.join(", ") || "(none yet)"}`);
  console.log(`  banned eras:      ${bannedEras.join(", ") || "(none yet)"}\n`);

  const provider = new ClaudeResearchProvider(
    createClaudeAIKernel(),
    buildResearchContext(getNicheProfile("scary-stories")),
  );

  const result = await provider.research({
    topic: assigned,
    historical: true,
    avoidTopics: past.map((t) => t.title),
    avoidCountries: bannedCountries,
    avoidEras: bannedEras,
  });

  const pkg = result.package;
  if (!pkg) {
    console.log("✗ No package parsed.");
  } else {
    console.log(`=== ${pkg.eventName} ===`);
    console.log(`${pkg.location}, ${pkg.country} · ${pkg.period} · era: ${pkg.era}`);
    console.log(`\n🩸 SHOCKING FACT\n${pkg.shockingFact}`);
    console.log(`\n--- Summary ---\n${result.summary}`);
    console.log(`\n--- Timeline ---`);
    for (const t of pkg.timeline) {
      console.log(` ${t.when}: ${t.what}`);
    }
    console.log(`\n--- Official explanation ---\n${pkg.officialExplanation}`);
    console.log(`\n--- Alternative theories ---`);
    for (const t of pkg.alternativeTheories) {
      console.log(` • ${t.theory} (${t.proponents})`);
    }
    console.log(`\n--- Why still debated ---\n${pkg.whyDebated}`);
    console.log(`\n--- Still unexplained ---`);
    for (const f of pkg.unexplainedFacts) {
      console.log(` ? ${f}`);
    }
    console.log(`\n--- Claims (evidence grading) ---`);
    for (const c of pkg.claims) {
      console.log(` [${c.type}/${c.confidence}] ${c.claim}`);
    }
  }

  console.log(`\n--- Sources (${result.references.length}) ---`);
  for (const r of result.references) {
    console.log(` - ${r.title} (${r.url ?? ""})`);
  }

  const searches = result.metadata.webSearchCount ?? 0;
  const cost = claudeCostUsd(result.metadata.tokenUsage) + webSearchCostUsd(searches);
  console.log(`\n${searches} searches · ${result.metadata.latencyMs} ms · ~$${cost.toFixed(3)}`);

  if (result.warnings.length > 0) {
    console.log(`\n--- Warnings ---`);
    for (const w of result.warnings) {
      console.log(` ! ${w}`);
    }
  }
}

main().catch((error: unknown) => {
  logger.error("Historical research demo failed", { error: String(error) });
  process.exitCode = 1;
});
