/**
 * Niche demo — proves the studio is now DYNAMIC per niche.
 *
 * For every niche it prints the creative profile and the derived per-stage
 * contexts (so you can see one `niche` drive every stage), then — if
 * OPENAI_API_KEY is set — synthesizes a short on-theme sample line in that niche's
 * OWN voice + delivery, so you can HEAR the difference (onyx dark-humor vs. echo
 * crisp vs. shimmer warm vs. fable narrator).
 *
 *   npm run demo:niches
 */
import { NICHE_PROFILES } from "../config/niche-profiles.js";
import {
  DEFAULT_RUN_SETTINGS,
  buildResearchContext,
  buildNarrativeContext,
  buildVisualDirectionContext,
  buildVoiceGenerationContext,
} from "../config/niche-context.js";
import { OpenAIVoiceGenerationProvider } from "../providers/voice-generation/index.js";
import type { NarrativeScript } from "../providers/narrative/index.js";
import type { PresetNiche } from "../types/index.js";
import { logger } from "../lib/logger.js";

try {
  process.loadEnvFile();
} catch {
  // No .env — fall back to the ambient environment.
}

/** A short, on-theme sample line per niche (to showcase the voice identity). */
const SAMPLE_LINES: Readonly<Record<PresetNiche, string>> = {
  "scary-stories": "They told me the house was empty. So who just turned off the lights upstairs?",
  "tech-news": "A new AI chip just doubled every phone's speed overnight. Here's why it actually matters.",
  "relationship-advice": "If they wanted to, they would. Stop making excuses for someone who won't show up for you.",
  "user-storytelling": "I almost missed that train. Missing it would have quietly changed my entire life.",
};

/** Build a one-segment NarrativeScript carrying a single sample line. */
function sampleNarrative(text: string): NarrativeScript {
  return {
    hook: text,
    segments: [{ startSecond: 0, endSecond: 6, text, emotion: "neutral", visualHint: "" }],
    callToAction: "",
    estimatedDurationSeconds: 6,
    warnings: [],
    metadata: {
      promptId: "sample",
      promptVersion: "v1",
      provider: "sample",
      model: "sample",
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      latencyMs: 0,
    },
  };
}

async function main(): Promise<void> {
  const hasKey = Boolean(process.env.OPENAI_API_KEY);

  for (const niche of Object.keys(NICHE_PROFILES) as PresetNiche[]) {
    const profile = NICHE_PROFILES[niche];
    const research = buildResearchContext(profile);
    const narrative = buildNarrativeContext(profile);
    const visual = buildVisualDirectionContext(profile);
    const voice = buildVoiceGenerationContext(profile);

    console.log(`\n============================================================`);
    console.log(`${profile.label}  (${niche})`);
    console.log(`------------------------------------------------------------`);
    console.log(`  Voice:        ${voice.voice}  —  "${profile.voiceInstructions}"`);
    console.log(`  Tone:         ${profile.tone}`);
    console.log(`  Audience:     ${profile.audience}`);
    console.log(`  Visual style: ${visual.overallVisualStyle}`);
    console.log(`  Music mood:   ${profile.musicMood}`);
    console.log(`  Pacing:       ${profile.pacing}`);
    console.log(`  (research ctx → tone="${research.tone}", narrative ctx → lang="${narrative.language}")`);

    if (!hasKey) {
      continue;
    }

    // Synthesize a sample line in THIS niche's voice + delivery.
    const outputDir = `output/voice/samples/${niche}`;
    const provider = new OpenAIVoiceGenerationProvider({
      ...voice,
      outputDir,
    });
    try {
      const result = await provider.generate({ narrative: sampleNarrative(SAMPLE_LINES[niche]) });
      const first = result.segments[0];
      if (first) {
        console.log(`  🔊 Sample:    ${first.audioPath}  (${first.actualDurationSeconds}s)`);
      }
      for (const warning of result.warnings) {
        console.log(`     ! [${warning.code}] ${warning.message}`);
      }
    } catch (error) {
      logger.error(`Voice sample failed for ${niche}`, { error: String(error) });
    }
  }

  if (!hasKey) {
    console.log(`\n(Set OPENAI_API_KEY to also synthesize a voice sample per niche.)`);
  } else {
    console.log(`\nDone. Play the files under output/voice/samples/<niche>/ to compare voices.`);
    console.log(`Run settings: ${DEFAULT_RUN_SETTINGS.width}x${DEFAULT_RUN_SETTINGS.height}, ${DEFAULT_RUN_SETTINGS.targetDurationSeconds}s target.`);
  }
}

main().catch((error: unknown) => {
  logger.error("Niche demo failed", { error: String(error) });
  process.exitCode = 1;
});
