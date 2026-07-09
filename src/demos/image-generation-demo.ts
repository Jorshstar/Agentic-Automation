/**
 * Image generation demo — production stage 3 (real pixels).
 *
 * Takes a small AssetPlan (4 scary-story segments) and generates a real image per
 * segment with OpenAI Images, niche-styled via the profile's visual identity:
 *
 *   AssetPlan (visualPrompts) → OpenAIImageGenerationProvider → OpenAI Images
 *     → output/assets/images/<segmentId>.png
 *
 * Generates 4 images (~a few cents). Requires OPENAI_API_KEY. Without it, exits
 * cleanly with a notice.
 *
 *   npm run demo:image-generation
 */
import { OpenAIImageGenerationProvider } from "../providers/image-generation/index.js";
import type { AssetPlan } from "../providers/asset-planning/index.js";
import { getNicheProfile } from "../config/niche-profiles.js";
import { buildImageGenerationContext } from "../config/niche-context.js";
import { logger } from "../lib/logger.js";

try {
  process.loadEnvFile();
} catch {
  // No .env — fall back to the ambient environment.
}

const EMPTY_META = {
  promptId: "sample",
  promptVersion: "v1",
  provider: "claude",
  model: "claude-opus-4-8",
  tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  latencyMs: 0,
} as const;

/** A small asset plan (scary-stories) — 4 segments → 4 images. */
const SAMPLE_ASSET_PLAN: AssetPlan = {
  segments: [
    {
      segmentId: "seg-1",
      assetType: "ai-image",
      primaryProvider: "openai-images",
      fallbackProvider: "runway",
      searchQueries: [],
      visualPrompt:
        "A dark, empty old house at night seen from the street, a single upstairs window faintly glowing, fog curling along the ground.",
      estimatedDuration: 5,
      licenseRequirements: "AI-generated",
      notes: "Establishing hook shot.",
    },
    {
      segmentId: "seg-2",
      assetType: "ai-image",
      primaryProvider: "openai-images",
      fallbackProvider: "runway",
      searchQueries: [],
      visualPrompt:
        "A shadowy staircase inside an abandoned house, moonlight cutting through a broken window, dust in the air, an ominous doorway at the top.",
      estimatedDuration: 5,
      licenseRequirements: "AI-generated",
      notes: "Rising tension.",
    },
    {
      segmentId: "seg-3",
      assetType: "ai-image",
      primaryProvider: "openai-images",
      fallbackProvider: "runway",
      searchQueries: [],
      visualPrompt:
        "A close-up of an old light switch on a cracked wall, a pale hand just out of focus reaching toward it, deep shadows.",
      estimatedDuration: 5,
      licenseRequirements: "AI-generated",
      notes: "The turn.",
    },
    {
      segmentId: "seg-4",
      assetType: "ai-image",
      primaryProvider: "openai-images",
      fallbackProvider: "runway",
      searchQueries: [],
      visualPrompt:
        "A silhouette standing at the end of a dark hallway, faint red glow behind it, unsettling and still, cinematic horror framing.",
      estimatedDuration: 5,
      licenseRequirements: "AI-generated",
      notes: "The reveal.",
    },
  ],
  warnings: [],
  metadata: EMPTY_META,
};

async function main(): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    logger.warn("Skipping image demo — set OPENAI_API_KEY to run it");
    return;
  }

  const profile = getNicheProfile("scary-stories");
  const context = buildImageGenerationContext(profile);
  const provider = new OpenAIImageGenerationProvider(context);

  console.log(`\nGenerating ${SAMPLE_ASSET_PLAN.segments.length} images (${context.model} @ ${context.size}, ${context.quality})...`);
  console.log(`Niche: ${profile.label} — ${profile.visualStyle}\n`);

  const result = await provider.generate({ assetPlan: SAMPLE_ASSET_PLAN });

  console.log("=== ImageGenerationProvider → OpenAI Images ===");
  console.log("Provider:", provider.name);
  console.log(`Generated: ${result.metadata.generated}/${result.metadata.requested}`);
  console.log(`Output dir: ${result.outputDir}`);
  console.log(`Total size: ${(result.metadata.totalBytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Latency: ${(result.metadata.latencyMs / 1000).toFixed(1)}s\n`);

  console.log("--- Images ---");
  for (const image of result.images) {
    if (image.status === "generated") {
      console.log(`  [${image.segmentId}] ✓ ${image.imagePath}  (${image.width}x${image.height}, ${(image.bytes / 1024).toFixed(0)} KB)`);
    } else {
      console.log(`  [${image.segmentId}] ✗ failed`);
    }
  }

  console.log("\n--- Warnings ---");
  if (result.warnings.length === 0) {
    console.log(" (none)");
  } else {
    for (const warning of result.warnings) {
      console.log(` ! [${warning.code}]${warning.segmentId ? " " + warning.segmentId : ""}: ${warning.message}`);
    }
  }

  console.log("\nOpen the PNGs under output/assets/images/ to review the look.");
}

main().catch((error: unknown) => {
  logger.error("Image demo failed", { error: String(error) });
  process.exitCode = 1;
});
