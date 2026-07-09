/**
 * SEO demo — the upload kit (YouTube + TikTok metadata).
 *
 * Feeds a representative finished-video's content (topic, hook, narration) into
 * the ClaudeSeoProvider and prints the platform-ready upload pack. One cheap
 * Claude text call via the AI Kernel — no video, no images, no TTS.
 *
 *   npm run demo:seo
 */
import { createClaudeAIKernel } from "../ai/index.js";
import { ClaudeSeoProvider } from "../providers/seo/index.js";
import { getNicheProfile } from "../config/niche-profiles.js";
import { logger } from "../lib/logger.js";

try {
  process.loadEnvFile();
} catch {
  // No .env — fall back to the ambient environment.
}

/** Representative content (from the real "3 AM Parking Garage" run). */
const SAMPLE = {
  topic: "The 3 AM Parking Garage",
  hook: "Level P4 wasn't on the elevator buttons yesterday, and the man sitting in the booth hasn't blinked since I said good morning.",
  script:
    "Level P4 wasn't on the elevator buttons yesterday, and the man in the booth hasn't blinked " +
    "since I said good morning. I work night shifts, so I park at 3 AM. The garage is always " +
    "empty — except tonight there's a new level below mine. The elevator hums as it sinks past " +
    "P3, into a floor that shouldn't exist. The doors open on rows of cars, all engines running, " +
    "all empty, headlights aimed at the elevator. And in my mirror, the booth attendant finally " +
    "blinks — from the back seat of my car. Follow for part two, if I make it out.",
  keywords: ["scary stories", "parking garage", "horror short", "3am", "creepypasta"],
  durationSeconds: 65,
};

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    logger.warn("Skipping SEO demo — set ANTHROPIC_API_KEY to run it");
    return;
  }

  const profile = getNicheProfile("scary-stories");
  const provider = new ClaudeSeoProvider(createClaudeAIKernel());

  const pack = await provider.generate({
    ...SAMPLE,
    niche: profile.label,
    tone: profile.tone,
    audience: profile.audience,
  });

  console.log("\n=== SeoProvider → AI Kernel → Claude ===");
  console.log("Provider:", provider.name);

  console.log("\n--- YouTube ---");
  console.log(`Title (${pack.youtube.title.length} chars):`);
  console.log(`  ${pack.youtube.title}`);
  console.log("Description:");
  console.log(`  ${pack.youtube.description}`);
  console.log(`Hashtags:  ${pack.youtube.hashtags.join(" ")}`);
  console.log(`Tags:      ${pack.youtube.tags.join(", ")}`);

  console.log("\n--- TikTok ---");
  console.log(`Caption (${pack.tiktok.caption.length} chars):`);
  console.log(`  ${pack.tiktok.caption}`);
  console.log(`Hashtags:  ${pack.tiktok.hashtags.join(" ")}`);

  console.log("\n--- Thumbnail ---");
  console.log(`Cover text: "${pack.thumbnailText}"`);

  console.log("\n--- Usage ---");
  console.log(JSON.stringify(pack.metadata.tokenUsage), `| ${pack.metadata.latencyMs} ms`);

  console.log("\n--- Warnings ---");
  if (pack.warnings.length === 0) {
    console.log(" (none)");
  } else {
    for (const warning of pack.warnings) {
      console.log(` ! [${warning.code}] ${warning.message}`);
    }
  }
}

main().catch((error: unknown) => {
  logger.error("SEO demo failed", { error: String(error) });
  process.exitCode = 1;
});
