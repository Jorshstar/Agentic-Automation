/**
 * Asset Planning demo — the stage AFTER visual direction (Step 24).
 *
 * A representative VisualDirectionPlan is fed into the ClaudeAssetPlanningProvider,
 * which calls the ONE AI entry point (AIKernel.generate()) and returns a
 * per-segment AssetPlan (sourcing recommendations only):
 *
 *   VisualDirectionPlan → AssetPlanningProvider → AIKernel.generate() → Claude
 *                      → parsed AssetPlan
 *
 * This is a PROVIDER demo only — it is NOT wired into the workflow yet, and it
 * downloads / generates NOTHING.
 *
 * Requires ANTHROPIC_API_KEY (see .env / README). Without it, the demo prints a
 * friendly notice and exits cleanly.
 *
 *   npm run demo:asset-plan
 */
import { createClaudeAIKernel } from "../ai/index.js";
import { ClaudeAssetPlanningProvider } from "../providers/asset-planning/index.js";
import type { VisualDirectionPlan } from "../providers/visual-direction/index.js";
import { logger } from "../lib/logger.js";

// Load .env into process.env (Node built-in). tsx doesn't do this automatically.
try {
  process.loadEnvFile();
} catch {
  // No .env file — fall back to the ambient environment.
}

/** A representative visual direction plan (as the Visual Direction stage would produce). */
const SAMPLE_VISUAL_DIRECTION: VisualDirectionPlan = {
  segments: [
    {
      segmentId: "seg-1",
      assetType: "ai-video",
      cameraMovement: "Slow push-in toward the X-ray display",
      visualStyle: "High-tech medical scan with glowing AI detection overlays",
      colorMood: "Cool blues and cyan with high-contrast white highlights",
      transition: "Fade in from black",
      animationStyle: "Pulsing scan lines and animated highlight boxes",
      preferredSource: "AI (Runway)",
      notes: "Open with a hook feel; bold on-screen text.",
    },
    {
      segmentId: "seg-2",
      assetType: "ai-video",
      cameraMovement: "Slow lateral pan across a CT scan",
      visualStyle: "Detailed CT cross-section with animated AI markers",
      colorMood: "Clinical blue-teal with bright accent markers",
      transition: "Quick cross-dissolve",
      animationStyle: "Markers snap into place with a radar-sweep",
      preferredSource: "AI (Runway)",
      notes: "Bold text 'Catch diseases earlier'.",
    },
    {
      segmentId: "seg-3",
      assetType: "motion-graphics",
      cameraMovement: "Gentle upward tilt revealing a dashboard",
      visualStyle: "Clean UI dashboard with risk gauges and trend graphs",
      colorMood: "Optimistic blues with green upward accents",
      transition: "Slide-up wipe",
      animationStyle: "Counters ticking up, line graphs drawing on",
      preferredSource: "After Effects",
      notes: "Animate risk gauge red → green.",
    },
    {
      segmentId: "seg-4",
      assetType: "stock-video",
      cameraMovement: "Slow dolly-in on a doctor-patient interaction",
      visualStyle: "Warm, human clinical scene with paperwork dissolving",
      colorMood: "Warm, soft natural tones",
      transition: "Cross-dissolve",
      animationStyle: "Paperwork graphics fade and disperse",
      preferredSource: "Pexels",
      notes: "Overlay 'More time for patients'.",
    },
    {
      segmentId: "seg-5",
      assetType: "motion-graphics",
      cameraMovement: "Rotating orbit around a DNA strand",
      visualStyle: "3D DNA helix morphing into a treatment plan card",
      colorMood: "Vibrant teal-to-purple gradient",
      transition: "Morph transition",
      animationStyle: "Helix unspools into UI elements",
      preferredSource: "After Effects",
      notes: "Bold text 'Tailored to YOUR data'.",
    },
    {
      segmentId: "seg-6",
      assetType: "stock-video",
      cameraMovement: "Static shot with slight handheld feel",
      visualStyle: "Doctor reviewing an AI suggestion and making the call",
      colorMood: "Balanced neutral tones, grounded",
      transition: "Hard cut",
      animationStyle: "AI card appears, checkmark stamp",
      preferredSource: "Pexels",
      notes: "Emphasize 'assists, not replaces'.",
    },
    {
      segmentId: "seg-7",
      assetType: "motion-graphics",
      cameraMovement: "Subtle push-in on a shield icon",
      visualStyle: "Shield icon securing patient data, doctor + AI balanced",
      colorMood: "Secure deep blues with accent gold",
      transition: "Cross-dissolve",
      animationStyle: "Shield locks with a glow, data streams flow",
      preferredSource: "After Effects",
      notes: "Bold text 'Accuracy & Privacy Matter'.",
    },
    {
      segmentId: "seg-8",
      assetType: "mixed",
      cameraMovement: "Static split-screen with subtle zoom on prompts",
      visualStyle: "Split screen of doctor and AI with comment/follow buttons",
      colorMood: "Bright, energetic high-contrast blues and white",
      transition: "Quick split-slide reveal",
      animationStyle: "Buttons bounce in with pulsing CTA",
      preferredSource: "After Effects",
      notes: "Clear Comment & Follow CTA.",
    },
  ],
  warnings: [],
  metadata: {
    promptId: "visual-direction.user",
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
    logger.warn("Skipping asset-plan demo — set ANTHROPIC_API_KEY to run it");
    return;
  }

  const kernel = createClaudeAIKernel();
  const provider = new ClaudeAssetPlanningProvider(kernel);

  const plan = await provider.plan({ visualDirection: SAMPLE_VISUAL_DIRECTION });

  console.log("\n=== AssetPlanningProvider → AI Kernel → Claude ===");
  console.log("Provider:", provider.name);

  console.log("\n--- Per-Segment Asset Plan ---");
  plan.segments.forEach((segment) => {
    console.log(`\n[${segment.segmentId}]  (${segment.estimatedDuration}s)`);
    console.log(`  Asset Type:        ${segment.assetType}`);
    console.log(`  Primary Provider:  ${segment.primaryProvider}`);
    console.log(`  Fallback Provider: ${segment.fallbackProvider}`);
    console.log(`  Search Queries:    ${segment.searchQueries.join(" | ") || "—"}`);
    console.log(`  Visual Prompt:     ${segment.visualPrompt || "—"}`);
    console.log(`  License:           ${segment.licenseRequirements || "—"}`);
    if (segment.notes) {
      console.log(`  Notes:             ${segment.notes}`);
    }
  });

  console.log("\n--- Token Usage / Latency ---");
  console.log(JSON.stringify(plan.metadata.tokenUsage), `| ${plan.metadata.latencyMs} ms`);

  if (plan.warnings.length > 0) {
    console.log("\n--- Warnings ---");
    for (const warning of plan.warnings) {
      console.log(" !", warning);
    }
  }
}

main().catch((error: unknown) => {
  logger.error("Asset-plan demo failed", { error: String(error) });
  process.exitCode = 1;
});
