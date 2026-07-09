/**
 * Visual Direction demo — the stage AFTER the narration timeline (Step 23).
 *
 * A representative NarrativeScript is fed into the ClaudeVisualDirectionProvider,
 * which calls the ONE AI entry point (AIKernel.generate()) and returns a
 * per-segment VisualDirectionPlan:
 *
 *   NarrativeScript → VisualDirectionProvider → AIKernel.generate() → Claude
 *                  → parsed VisualDirectionPlan
 *
 * This is a PROVIDER demo only — it is NOT wired into the workflow yet.
 *
 * Requires ANTHROPIC_API_KEY (see .env / README). Without it, the demo prints a
 * friendly notice and exits cleanly.
 *
 *   npm run demo:visual-direction
 */
import { createClaudeAIKernel } from "../ai/index.js";
import { ClaudeVisualDirectionProvider } from "../providers/visual-direction/index.js";
import type { NarrativeScript } from "../providers/narrative/index.js";
import { logger } from "../lib/logger.js";

// Load .env into process.env (Node built-in). tsx doesn't do this automatically.
try {
  process.loadEnvFile();
} catch {
  // No .env file — fall back to the ambient environment.
}

/** A representative narration timeline (as the Narrative stage would produce). */
const SAMPLE_NARRATIVE: NarrativeScript = {
  hook: "What if a computer could spot cancer as accurately as a top specialist? It's already happening.",
  segments: [
    {
      startSecond: 0,
      endSecond: 8,
      text: "What if a computer could spot cancer as accurately as a top specialist? It's already happening.",
      emotion: "curious",
      visualHint: "AI scanning a medical X-ray with highlighted areas",
      stockKeyword: "",
    },
    {
      startSecond: 8,
      endSecond: 16,
      text: "AI can analyze medical scans to help catch diseases earlier than ever before.",
      emotion: "informative",
      visualHint: "Close-up of a CT scan with AI markers detecting anomalies",
      stockKeyword: "",
    },
    {
      startSecond: 16,
      endSecond: 24,
      text: "It can even predict a patient's risks early, giving doctors a chance to act faster.",
      emotion: "hopeful",
      visualHint: "Dashboard showing patient risk scores and trend graphs",
      stockKeyword: "",
    },
    {
      startSecond: 24,
      endSecond: 32,
      text: "AI also handles time-consuming paperwork, freeing doctors to spend real time with patients.",
      emotion: "reassuring",
      visualHint: "Doctor talking warmly with a patient, paperwork fading away",
      stockKeyword: "",
    },
    {
      startSecond: 32,
      endSecond: 40,
      text: "And with personalized medicine, treatments can be tailored to your unique data.",
      emotion: "encouraging",
      visualHint: "DNA strands and a personalized treatment plan on screen",
      stockKeyword: "",
    },
    {
      startSecond: 40,
      endSecond: 47,
      text: "But here's the key: AI assists decisions, it does not replace your doctor.",
      emotion: "serious",
      visualHint: "Doctor reviewing AI suggestions, making the final call",
      stockKeyword: "",
    },
    {
      startSecond: 47,
      endSecond: 54,
      text: "Accuracy and privacy still matter enormously, with human judgment at the heart of care.",
      emotion: "serious",
      visualHint: "Shield icon over patient data, doctor and AI side by side",
      stockKeyword: "",
    },
    {
      startSecond: 54,
      endSecond: 60,
      text: "AI is a powerful tool working alongside doctors. Would you trust it? Comment and follow!",
      emotion: "engaging",
      visualHint: "Split screen of doctor and AI, comment and follow prompts",
      stockKeyword: "",
    },
  ],
  callToAction: "Would you trust AI to help with your diagnosis? Comment and follow for more!",
  estimatedDurationSeconds: 60,
  warnings: [],
  metadata: {
    promptId: "narrative.user",
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
    logger.warn("Skipping visual-direction demo — set ANTHROPIC_API_KEY to run it");
    return;
  }

  const kernel = createClaudeAIKernel();
  const provider = new ClaudeVisualDirectionProvider(kernel);

  const plan = await provider.direct({ narrative: SAMPLE_NARRATIVE });

  console.log("\n=== VisualDirectionProvider → AI Kernel → Claude ===");
  console.log("Provider:", provider.name);

  console.log("\n--- Per-Segment Visual Direction ---");
  plan.segments.forEach((segment) => {
    console.log(`\n[${segment.segmentId}]`);
    console.log(`  Asset Type:      ${segment.assetType}`);
    console.log(`  Visual Style:    ${segment.visualStyle}`);
    console.log(`  Camera Movement: ${segment.cameraMovement}`);
    console.log(`  Color Mood:      ${segment.colorMood}`);
    console.log(`  Transition:      ${segment.transition}`);
    console.log(`  Animation:       ${segment.animationStyle}`);
    console.log(`  Preferred Source:${segment.preferredSource ? " " + segment.preferredSource : " —"}`);
    if (segment.notes) {
      console.log(`  Notes:           ${segment.notes}`);
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
  logger.error("Visual-direction demo failed", { error: String(error) });
  process.exitCode = 1;
});
