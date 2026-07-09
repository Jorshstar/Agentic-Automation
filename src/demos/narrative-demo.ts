/**
 * Narrative demo — the stage AFTER content planning (Step 22).
 *
 * A representative ContentPlan is fed into the ClaudeNarrativeProvider, which
 * calls the ONE AI entry point (AIKernel.generate()) and returns a timed,
 * structured NarrativeScript:
 *
 *   ContentPlan → NarrativeProvider → AIKernel.generate() → Claude
 *              → parsed NarrativeScript
 *
 * This is a PROVIDER demo only — it is NOT wired into the workflow yet.
 *
 * Requires ANTHROPIC_API_KEY (see .env / README). Without it, the demo prints a
 * friendly notice and exits cleanly.
 *
 *   npm run demo:narrative
 */
import { createClaudeAIKernel } from "../ai/index.js";
import { ClaudeNarrativeProvider } from "../providers/narrative/index.js";
import type { ContentPlan } from "../providers/content-planning/index.js";
import { logger } from "../lib/logger.js";

// Load .env into process.env (Node built-in). tsx doesn't do this automatically.
try {
  process.loadEnvFile();
} catch {
  // No .env file — fall back to the ambient environment.
}

/** A representative content plan (as the Content Planning stage would produce). */
const SAMPLE_CONTENT_PLAN: ContentPlan = {
  hook: "What if a computer could spot cancer as accurately as a top specialist? It's already happening.",
  coreMessage:
    "AI is transforming healthcare by helping doctors diagnose faster, personalize treatments, " +
    "and cut paperwork — but it assists doctors, it doesn't replace them.",
  targetAudience: "General Audience",
  tone: "Educational",
  estimatedDurationSeconds: 60,
  sections: [
    {
      title: "The Hook: AI Meets Medicine",
      purpose: "Grab attention with a surprising, relatable fact.",
      durationSeconds: 8,
      keyPoints: [
        "AI can detect diseases like cancer in medical scans, sometimes matching specialists.",
        "This is already changing how doctors work today.",
      ],
    },
    {
      title: "Faster Diagnosis & Early Warnings",
      purpose: "Explain how AI speeds up detection and improves outcomes.",
      durationSeconds: 16,
      keyPoints: [
        "AI analyzes scans to help catch diseases earlier.",
        "It predicts patient risks early, allowing faster treatment.",
      ],
    },
    {
      title: "More Time & Personalized Care",
      purpose: "Show the practical benefits for doctors and patients.",
      durationSeconds: 16,
      keyPoints: [
        "AI tools reduce paperwork, freeing doctors to spend time with patients.",
        "Personalized medicine tailors treatments to a patient's unique data.",
      ],
    },
    {
      title: "Doctors Stay in Charge",
      purpose: "Reassure viewers and address oversight concerns.",
      durationSeconds: 14,
      keyPoints: [
        "AI assists decisions but does not replace medical professionals.",
        "Accuracy and privacy remain important.",
      ],
    },
    {
      title: "Wrap-Up",
      purpose: "Summarize the balanced takeaway and prompt engagement.",
      durationSeconds: 6,
      keyPoints: ["AI is a powerful tool working alongside doctors, not instead of them."],
    },
  ],
  callToAction:
    "Would you trust AI to help with your diagnosis? Drop your thoughts in the comments and follow for more!",
  visualStyle: "Clean, modern, clinical visuals with bright accent colors and on-screen text.",
  riskNotes: ["Avoid implying AI replaces doctors.", "Do not give medical advice."],
  warnings: [],
  metadata: {
    promptId: "content-plan.user",
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
    logger.warn("Skipping narrative demo — set ANTHROPIC_API_KEY to run it");
    return;
  }

  const kernel = createClaudeAIKernel();
  const provider = new ClaudeNarrativeProvider(kernel);

  const script = await provider.narrate({ contentPlan: SAMPLE_CONTENT_PLAN });

  console.log("\n=== NarrativeProvider → AI Kernel → Claude ===");
  console.log("Provider:", provider.name);

  console.log("\n--- Hook ---");
  console.log(script.hook || "(none)");

  console.log("\n--- Segment Timeline ---");
  script.segments.forEach((segment, index) => {
    console.log(
      `${index + 1}. [${segment.startSecond}s–${segment.endSecond}s] ` +
        `(${segment.emotion}) — visual: ${segment.visualHint}`,
    );
  });

  console.log("\n--- Narration ---");
  for (const segment of script.segments) {
    console.log(`[${segment.startSecond}s–${segment.endSecond}s] ${segment.text}`);
  }

  console.log("\n--- Call To Action ---");
  console.log(script.callToAction || "(none)");

  console.log("\n--- Estimated Duration ---");
  console.log(`${script.estimatedDurationSeconds}s`);

  console.log("\n--- Token Usage / Latency ---");
  console.log(JSON.stringify(script.metadata.tokenUsage), `| ${script.metadata.latencyMs} ms`);

  if (script.warnings.length > 0) {
    console.log("\n--- Warnings ---");
    for (const warning of script.warnings) {
      console.log(" !", warning);
    }
  }
}

main().catch((error: unknown) => {
  logger.error("Narrative demo failed", { error: String(error) });
  process.exitCode = 1;
});
