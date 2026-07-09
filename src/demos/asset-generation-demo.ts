/**
 * Asset Generation demo — the first PRODUCTION stage (Step 26).
 *
 * A representative AssetPlan is fed into the ClaudeAssetGenerationProvider, which
 * calls the ONE AI entry point (AIKernel.generate()) and returns GeneratedAssets
 * — a fully-specified production manifest of the media resources:
 *
 *   AssetPlan → AssetGenerationProvider → AIKernel.generate() → Claude
 *            → parsed AssetProviderResult[] → enriched GeneratedAssets
 *
 * This is a PROVIDER demo only — it downloads NOTHING, generates NO files, and
 * renders NOTHING. It describes the assets that would be produced later.
 *
 * Requires ANTHROPIC_API_KEY (see .env / README). Without it, the demo prints a
 * friendly notice and exits cleanly.
 *
 *   npm run demo:asset-generation
 */
import { createClaudeAIKernel } from "../ai/index.js";
import { ClaudeAssetGenerationProvider } from "../providers/asset-generation/index.js";
import type { AssetPlan } from "../providers/asset-planning/index.js";
import { logger } from "../lib/logger.js";

// Load .env into process.env (Node built-in). tsx doesn't do this automatically.
try {
  process.loadEnvFile();
} catch {
  // No .env file — fall back to the ambient environment.
}

/** A representative asset plan (as the Asset Planning stage would produce). */
const SAMPLE_ASSET_PLAN: AssetPlan = {
  segments: [
    {
      segmentId: "seg-1",
      assetType: "ai-video",
      primaryProvider: "runway",
      fallbackProvider: "google-veo",
      searchQueries: ["AI medical X-ray scan detection", "glowing AI overlay X-ray"],
      visualPrompt: "High-tech medical X-ray with glowing AI detection overlays, cool blues, 9:16.",
      estimatedDuration: 8,
      licenseRequirements: "AI-generated, commercial use OK",
      notes: "Hook shot.",
    },
    {
      segmentId: "seg-2",
      assetType: "motion-graphics",
      primaryProvider: "local-storage",
      fallbackProvider: "user-library",
      searchQueries: ["medical risk dashboard UI", "risk gauge animation"],
      visualPrompt: "Clean UI dashboard with risk gauges animating red to green, 9:16.",
      estimatedDuration: 8,
      licenseRequirements: "Custom-made, full commercial rights",
      notes: "Data viz.",
    },
    {
      segmentId: "seg-3",
      assetType: "stock-video",
      primaryProvider: "pexels",
      fallbackProvider: "pixabay",
      searchQueries: ["doctor patient consultation warm", "friendly doctor talking to patient"],
      visualPrompt: "Warm clinical scene of a doctor with a patient, 9:16.",
      estimatedDuration: 8,
      licenseRequirements: "royalty-free, commercial use OK",
      notes: "Human warmth.",
    },
    {
      segmentId: "seg-4",
      assetType: "ai-image",
      primaryProvider: "openai-images",
      fallbackProvider: "runway",
      searchQueries: [],
      visualPrompt: "A 3D DNA helix morphing into a personalized treatment plan card, teal-purple, 9:16.",
      estimatedDuration: 6,
      licenseRequirements: "AI-generated, commercial use OK",
      notes: "Personalized medicine.",
    },
    {
      segmentId: "seg-5",
      assetType: "mixed",
      primaryProvider: "local-storage",
      fallbackProvider: "pexels",
      searchQueries: ["split screen doctor and AI", "comment follow CTA animation"],
      visualPrompt: "Split screen of doctor and AI with animated comment and follow buttons, 9:16.",
      estimatedDuration: 6,
      licenseRequirements: "Custom + royalty-free, commercial use OK",
      notes: "Closer with CTA.",
    },
  ],
  warnings: [],
  metadata: {
    promptId: "asset-plan.user",
    promptVersion: "v1",
    provider: "claude",
    model: "claude-opus-4-8",
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    latencyMs: 0,
  },
};

async function main(): Promise<void> {
  // No key ⇒ nothing to demo. Check presence only (never log the value).
  if (!process.env.ANTHROPIC_API_KEY) {
    logger.warn("Skipping asset-generation demo — set ANTHROPIC_API_KEY to run it");
    return;
  }

  const kernel = createClaudeAIKernel();
  const provider = new ClaudeAssetGenerationProvider(kernel);

  const generated = await provider.generate({ assetPlan: SAMPLE_ASSET_PLAN });

  console.log("\n=== AssetGenerationProvider → AI Kernel → Claude ===");
  console.log("Provider:", provider.name);
  console.log(`Assets produced: ${generated.assets.length}`);

  console.log("\n--- Generated Assets ---");
  generated.assets.forEach((asset) => {
    console.log(`\n[${asset.assetId} · ${asset.sceneId} · ${asset.segmentId}]`);
    console.log(`  Asset Type:  ${asset.assetType}`);
    console.log(`  Provider:    ${asset.provider}  (method: ${asset.generationMethod}, status: ${asset.metadata.status})`);
    console.log(`  Source Ref:  ${asset.sourceUrl || "—"}`);
    console.log(`  Local Path:  ${asset.localPath}`);
    console.log(`  Media:       ${asset.mimeType}  ${asset.width}x${asset.height}  ${asset.durationSeconds}s`);
    console.log(`  License:     ${asset.license || "—"}`);
    console.log(`  Est. Cost:   $${asset.metadata.estimatedCostUsd}`);
    console.log(`  Fallback:    ${asset.metadata.fallbackProvider}`);
    console.log(`  Checksum:    ${asset.checksum || "(pending — file not yet produced)"}`);
  });

  console.log("\n--- Token Usage / Latency ---");
  console.log(JSON.stringify(generated.metadata.tokenUsage), `| ${generated.metadata.latencyMs} ms`);

  console.log("\n--- Warnings ---");
  if (generated.warnings.length === 0) {
    console.log(" (none — zero parser failures)");
  } else {
    for (const warning of generated.warnings) {
      console.log(` ! [${warning.code}]${warning.segmentId ? " " + warning.segmentId : ""}: ${warning.message}`);
    }
  }
}

main().catch((error: unknown) => {
  logger.error("Asset-generation demo failed", { error: String(error) });
  process.exitCode = 1;
});
