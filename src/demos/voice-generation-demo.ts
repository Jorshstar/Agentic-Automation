/**
 * Voice Generation demo — the first PRODUCTION output stage.
 *
 * A representative NarrativeScript is fed into the OpenAIVoiceGenerationProvider,
 * which calls OpenAI TTS per segment, writes real .mp3 files, and measures each
 * with ffprobe to build the ACTUAL timeline:
 *
 *   NarrativeScript → OpenAIVoiceGenerationProvider → OpenAI TTS
 *                  → real audio files + measured timeline
 *
 * This WRITES real audio files to ./output/voice. It needs a paid OPENAI_API_KEY
 * (a 60s narration costs a fraction of a cent). Without the key it exits cleanly.
 *
 *   npm run demo:voice-generation
 */
import { statSync } from "node:fs";
import { OpenAIVoiceGenerationProvider } from "../providers/voice-generation/index.js";
import type { NarrativeScript } from "../providers/narrative/index.js";
import { logger } from "../lib/logger.js";

// Load .env into process.env (Node built-in). tsx doesn't do this automatically.
try {
  process.loadEnvFile();
} catch {
  // No .env file — fall back to the ambient environment.
}

/** A short representative narration timeline (kept brief to keep the demo cheap). */
const SAMPLE_NARRATIVE: NarrativeScript = {
  hook: "What if a computer could spot cancer as accurately as a top specialist?",
  segments: [
    {
      startSecond: 0,
      endSecond: 8,
      text: "What if a computer could spot cancer as accurately as a top specialist? It's already happening.",
      emotion: "curious",
      visualHint: "AI scanning a medical X-ray",
    },
    {
      startSecond: 8,
      endSecond: 16,
      text: "AI can analyze medical scans to help catch diseases earlier than ever before.",
      emotion: "informative",
      visualHint: "CT scan with AI markers",
    },
    {
      startSecond: 16,
      endSecond: 24,
      text: "But here's the key: AI assists doctors, it does not replace them.",
      emotion: "reassuring",
      visualHint: "Doctor reviewing AI results",
    },
    {
      startSecond: 24,
      endSecond: 30,
      text: "Would you trust AI to help with your diagnosis? Comment and follow for more!",
      emotion: "engaging",
      visualHint: "Comment and follow prompts",
    },
  ],
  callToAction: "Would you trust AI to help with your diagnosis? Comment and follow for more!",
  estimatedDurationSeconds: 30,
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

function fileSizeKb(path: string): string {
  try {
    return `${Math.round(statSync(path).size / 1024)} KB`;
  } catch {
    return "missing";
  }
}

async function main(): Promise<void> {
  // No key ⇒ nothing to demo. Check presence only (never log the value).
  if (!process.env.OPENAI_API_KEY) {
    logger.warn("Skipping voice-generation demo — set OPENAI_API_KEY in .env to run it");
    return;
  }

  const provider = new OpenAIVoiceGenerationProvider();
  const voiceover = await provider.generate({ narrative: SAMPLE_NARRATIVE });

  console.log("\n=== VoiceGenerationProvider → OpenAI TTS ===");
  console.log("Provider:", provider.name);
  console.log("Voice / Model:", `${voiceover.metadata.voice} / ${voiceover.metadata.model}`);
  console.log("Output dir:", voiceover.outputDir);
  console.log(`Segments synthesized: ${voiceover.segments.length}`);

  console.log("\n--- Segments (real audio + measured timeline) ---");
  voiceover.segments.forEach((segment) => {
    console.log(`\n[${segment.segmentId}]  ${segment.actualStartSecond}s → ${segment.actualEndSecond}s  (${segment.actualDurationSeconds}s actual, planned ${segment.plannedEndSecond - segment.plannedStartSecond}s)`);
    console.log(`  Text:  "${segment.text.slice(0, 70)}${segment.text.length > 70 ? "…" : ""}"`);
    console.log(`  Audio: ${segment.audioPath}  (${fileSizeKb(segment.audioPath)})`);
  });

  console.log("\n--- Totals ---");
  console.log(`Real total duration: ${voiceover.totalDurationSeconds}s`);
  console.log(`Characters spoken:   ${voiceover.metadata.totalCharacters}`);
  console.log(`Latency:             ${voiceover.metadata.latencyMs} ms`);

  console.log("\n--- Warnings ---");
  if (voiceover.warnings.length === 0) {
    console.log(" (none)");
  } else {
    for (const warning of voiceover.warnings) {
      console.log(` ! [${warning.code}]${warning.segmentId ? " " + warning.segmentId : ""}: ${warning.message}`);
    }
  }
}

main().catch((error: unknown) => {
  logger.error("Voice-generation demo failed", { error: String(error) });
  process.exitCode = 1;
});
