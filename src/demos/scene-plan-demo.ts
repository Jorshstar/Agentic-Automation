/**
 * Scene Planning demo — merges three plans into the execution contract (Step 25).
 *
 * Representative NarrativeScript + VisualDirectionPlan + AssetPlan are fed into
 * the ClaudeScenePlanningProvider, which calls the ONE AI entry point
 * (AIKernel.generate()) and returns a merged, ordered ScenePlan:
 *
 *   Narrative + VisualDirection + AssetPlan → ScenePlanningProvider
 *     → AIKernel.generate() → Claude → parsed ScenePlan
 *
 * This is a PROVIDER demo only — it is NOT wired into the workflow yet, and it
 * generates NOTHING (no assets, audio, captions, or video).
 *
 * Requires ANTHROPIC_API_KEY (see .env / README). Without it, the demo prints a
 * friendly notice and exits cleanly.
 *
 *   npm run demo:scene-plan
 */
import { createClaudeAIKernel } from "../ai/index.js";
import { ClaudeScenePlanningProvider } from "../providers/scene-planning/index.js";
import type { NarrativeScript } from "../providers/narrative/index.js";
import type { VisualDirectionPlan } from "../providers/visual-direction/index.js";
import type { AssetPlan } from "../providers/asset-planning/index.js";
import { logger } from "../lib/logger.js";

// Load .env into process.env (Node built-in). tsx doesn't do this automatically.
try {
  process.loadEnvFile();
} catch {
  // No .env file — fall back to the ambient environment.
}

const EMPTY_META = {
  promptId: "sample",
  promptVersion: "v1",
  provider: "claude",
  model: "claude-opus-4-8",
  tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  latencyMs: 0,
} as const;

/** The eight aligned segment ids/timings shared by all three plans. */
const TIMELINE = [
  [0, 8],
  [8, 16],
  [16, 24],
  [24, 32],
  [32, 40],
  [40, 47],
  [47, 54],
  [54, 60],
] as const;

const NARRATION_TEXT = [
  "What if a computer could spot cancer as accurately as a top specialist? It's already happening.",
  "AI can analyze medical scans to help catch diseases earlier than ever before.",
  "It can even predict a patient's risks early, giving doctors a chance to act faster.",
  "AI also handles paperwork, freeing doctors to spend real time with patients.",
  "And with personalized medicine, treatments can be tailored to your unique data.",
  "But here's the key: AI assists decisions, it does not replace your doctor.",
  "Accuracy and privacy still matter enormously, with human judgment at the heart of care.",
  "AI is a powerful tool working alongside doctors. Would you trust it? Comment and follow!",
] as const;

const EMOTIONS = [
  "curious",
  "informative",
  "hopeful",
  "reassuring",
  "encouraging",
  "serious",
  "serious",
  "engaging",
] as const;

const ASSET_TYPES = [
  "ai-video",
  "ai-video",
  "motion-graphics",
  "stock-video",
  "motion-graphics",
  "stock-video",
  "motion-graphics",
  "mixed",
] as const;

const CAMERA = [
  "Slow push-in",
  "Slow lateral pan",
  "Gentle upward tilt",
  "Slow dolly-in",
  "Rotating orbit",
  "Static handheld",
  "Subtle push-in",
  "Static split-screen",
] as const;

const PROVIDERS = [
  ["runway", "google-veo"],
  ["runway", "google-veo"],
  ["local-storage", "user-library"],
  ["pexels", "pixabay"],
  ["local-storage", "user-library"],
  ["pexels", "pixabay"],
  ["local-storage", "user-library"],
  ["local-storage", "pexels"],
] as const;

const OVERLAYS = [
  "Spot cancer like a specialist?",
  "Catch diseases earlier",
  "Predict risks early",
  "More time for patients",
  "Tailored to YOUR data",
  "Assists, not replaces",
  "Accuracy & Privacy Matter",
  "Would you trust it?",
] as const;

const SAMPLE_NARRATIVE: NarrativeScript = {
  hook: NARRATION_TEXT[0],
  segments: TIMELINE.map(([start, end], i) => ({
    startSecond: start,
    endSecond: end,
    text: NARRATION_TEXT[i] ?? "",
    emotion: EMOTIONS[i] ?? "neutral",
    visualHint: OVERLAYS[i] ?? "",
  })),
  callToAction: "Would you trust AI to help with your diagnosis? Comment and follow for more!",
  estimatedDurationSeconds: 60,
  warnings: [],
  metadata: EMPTY_META,
};

const SAMPLE_VISUAL_DIRECTION: VisualDirectionPlan = {
  segments: TIMELINE.map((_, i) => ({
    segmentId: `seg-${i + 1}`,
    assetType: ASSET_TYPES[i] ?? "mixed",
    cameraMovement: CAMERA[i] ?? "Static",
    visualStyle: "Clean, modern medical visuals with bold on-screen text",
    colorMood: "High-contrast blues with bright accents",
    transition: "Cross-dissolve",
    animationStyle: "Smooth motion with animated highlights",
    preferredSource: PROVIDERS[i]?.[0] ?? "local-storage",
    notes: OVERLAYS[i] ?? "",
  })),
  warnings: [],
  metadata: EMPTY_META,
};

const SAMPLE_ASSET_PLAN: AssetPlan = {
  segments: TIMELINE.map(([start, end], i) => ({
    segmentId: `seg-${i + 1}`,
    assetType: ASSET_TYPES[i] ?? "mixed",
    primaryProvider: PROVIDERS[i]?.[0] ?? "local-storage",
    fallbackProvider: PROVIDERS[i]?.[1] ?? "user-library",
    searchQueries: [`${OVERLAYS[i] ?? "healthcare"} b-roll`, "medical technology clip"],
    visualPrompt: `${ASSET_TYPES[i]} of ${OVERLAYS[i]} — clean modern medical style, vertical 9:16`,
    estimatedDuration: (end - start),
    licenseRequirements: "royalty-free / commercial use OK",
    notes: OVERLAYS[i] ?? "",
  })),
  warnings: [],
  metadata: EMPTY_META,
};

async function main(): Promise<void> {
  // No key ⇒ nothing to demo. Check presence only (never log the value).
  if (!process.env.ANTHROPIC_API_KEY) {
    logger.warn("Skipping scene-plan demo — set ANTHROPIC_API_KEY to run it");
    return;
  }

  const kernel = createClaudeAIKernel();
  const provider = new ClaudeScenePlanningProvider(kernel);

  const plan = await provider.plan({
    narrative: SAMPLE_NARRATIVE,
    visualDirection: SAMPLE_VISUAL_DIRECTION,
    assetPlan: SAMPLE_ASSET_PLAN,
  });

  console.log("\n=== ScenePlanningProvider → AI Kernel → Claude ===");
  console.log("Provider:", provider.name);

  console.log("\n--- Scenes ---");
  plan.scenes.forEach((scene) => {
    console.log(`\n[${scene.sceneId} · ${scene.segmentId}]  [${scene.startSecond}s–${scene.endSecond}s]`);
    console.log(`  Primary Asset:  ${scene.primaryAsset || "—"}`);
    console.log(`  Fallback Asset: ${scene.fallbackAsset || "—"}`);
    console.log(`  Camera:         ${scene.cameraMovement || "—"}`);
    console.log(`  Overlay Text:   ${scene.overlayText || "—"}  (caption: ${scene.captionPosition})`);
    console.log(`  Transitions:    in=${scene.transitionIn || "—"} / out=${scene.transitionOut || "—"}`);
    console.log(`  Voice / Music:  voice=${scene.voiceSegmentId} / music=${scene.musicMood || "—"}`);
    if (scene.notes) {
      console.log(`  Notes:          ${scene.notes}`);
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
  logger.error("Scene-plan demo failed", { error: String(error) });
  process.exitCode = 1;
});
