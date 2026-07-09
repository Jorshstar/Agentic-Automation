import type { Niche, PresetNiche } from "../types/index.js";
import type { MusicMood } from "../providers/music-generation/index.js";

/**
 * Niche PROFILES — the creative identity of each niche.
 *
 * This is the "dynamic" backbone the whole studio was missing: one profile per
 * niche describes HOW that content should look and sound (voice + delivery, tone,
 * audience, visual style, colour, music, pacing). The context builders in
 * `niche-context.ts` turn a profile into each provider's context, so a single
 * `niche` drives every stage — Research, Content Plan, Narrative, Visual
 * Direction, Asset Generation, Voice — with no code changes per niche.
 *
 * This is CONFIG DATA + a lookup, not a new orchestration layer. It sits beside
 * the existing lightweight `NicheConfig` (id/label/description used for rotation);
 * this file adds the richer creative fields on top.
 */

export type Pacing = "slow" | "medium" | "fast";

export interface NicheProfile {
  readonly niche: Niche;
  readonly label: string;

  // --- Writing identity (drives Research → Content Plan → Narrative) ---
  readonly audience: string;
  readonly tone: string;
  readonly language: string;
  readonly pacing: Pacing;

  // --- Voice identity (drives Voice Generation / OpenAI TTS) ---
  /** OpenAI TTS voice id (e.g. "onyx"). */
  readonly voice: string;
  /** Delivery style sent to gpt-4o-mini-tts `instructions`. */
  readonly voiceInstructions: string;

  // --- Visual identity (drives Visual Direction → Asset Generation) ---
  readonly visualStyle: string;
  readonly colorMood: string;

  // --- Audio bed (drives Music selection/generation) ---
  /** Human description of the desired music (used in prompts/plans). */
  readonly musicMood: string;
  /** Which synth preset the FFmpeg music provider uses for this identity. */
  readonly musicPreset: MusicMood;

  // --- Caption identity (drives burned-in subtitle styling) ---
  /** Accent colour for captions, hex "#RRGGBB". */
  readonly captionAccent: string;
  /** Caption font family (a standard system font, e.g. "Arial Black"). */
  readonly captionFont: string;
  /** Where captions sit on screen. */
  readonly captionPosition: "bottom" | "center";
  /** Karaoke highlight: the whole sentence stays on screen, and each word turns
   *  the accent colour as it is spoken. Punchy niches on, calm niches off. */
  readonly captionKaraoke: boolean;

  // --- Topic seeds (for auto topic generation; explicit topic overrides) ---
  readonly topicThemes: readonly string[];
}

/** The creative profile for every PRESET niche ("custom" identities come from a
 *  ContentBrief via the identity designer, never from here). */
export const NICHE_PROFILES: Readonly<Record<PresetNiche, NicheProfile>> = {
  "scary-stories": {
    niche: "scary-stories",
    label: "Scary Stories",
    audience: "horror and thriller fans who love a chilling short story",
    tone: "eerie, suspenseful, with dry dark humor",
    language: "English",
    pacing: "slow",
    voice: "onyx",
    voiceInstructions:
      "Deep, slow, and ominous. Dry, dark humor. Menacing calm with deliberate pauses, " +
      "like telling a horror story by candlelight.",
    visualStyle:
      "dark cinematic horror, deep shadows, moody low-key lighting, film grain, high contrast",
    colorMood: "cold desaturated blacks and blues with sickly green or blood-red accents",
    musicMood: "tense low drone, unsettling ambient, suspenseful",
    musicPreset: "tense-drone",
    captionAccent: "#E63946",
    captionFont: "Arial Black",
    captionPosition: "bottom",
    captionKaraoke: true,
    topicThemes: [
      "urban legends",
      "unexplained events",
      "creepy late-night encounters",
      "liminal spaces",
      "short original horror",
    ],
  },
  "tech-news": {
    niche: "tech-news",
    label: "Tech News",
    audience: "curious tech enthusiasts who want the story fast",
    tone: "punchy, confident, informative",
    language: "English",
    pacing: "fast",
    voice: "echo",
    voiceInstructions:
      "Crisp, confident, and energetic. Fast-paced news-anchor delivery; punchy and clear.",
    visualStyle: "sleek modern tech, clean UI, neon accents, futuristic, high-tech",
    colorMood: "electric blues and cyans with neon highlights on dark backgrounds",
    musicMood: "upbeat electronic, driving, modern",
    musicPreset: "upbeat-electronic",
    captionAccent: "#00E5FF",
    captionFont: "Verdana",
    captionPosition: "bottom",
    captionKaraoke: true,
    topicThemes: [
      "AI breakthroughs",
      "new gadgets and devices",
      "big tech company moves",
      "science and space",
      "developer tools",
    ],
  },
  "relationship-advice": {
    niche: "relationship-advice",
    label: "Relationship Advice",
    audience: "people looking for honest, practical relationship guidance",
    tone: "warm, empathetic, sincere",
    language: "English",
    pacing: "medium",
    voice: "shimmer",
    voiceInstructions:
      "Warm, empathetic, and calm. Conversational and reassuring, like a trusted friend " +
      "giving honest advice.",
    visualStyle: "soft warm intimate, gentle bokeh, natural light, cozy",
    colorMood: "warm ambers, soft pinks and creams, gentle golden light",
    musicMood: "gentle warm pad, uplifting, sincere",
    musicPreset: "warm-pad",
    captionAccent: "#FFC857",
    captionFont: "Georgia",
    captionPosition: "bottom",
    captionKaraoke: false,
    topicThemes: [
      "communication tips",
      "dating advice",
      "conflict resolution",
      "self-worth and boundaries",
      "building trust",
    ],
  },
  "user-storytelling": {
    niche: "user-storytelling",
    label: "User Storytelling",
    audience: "viewers who love a well-told 60-second story",
    tone: "narrative, immersive, expressive",
    language: "English",
    pacing: "medium",
    voice: "fable",
    voiceInstructions:
      "Expressive storyteller with dynamic pacing and emotional beats; draw the listener in " +
      "like a great narrator.",
    visualStyle: "filmic, warm, character-driven, cinematic, shallow depth of field",
    colorMood: "rich warm cinematic grade, teal-and-orange, expressive",
    musicMood: "emotive cinematic score, building, heartfelt",
    musicPreset: "emotive-score",
    captionAccent: "#F4A261",
    captionFont: "Trebuchet MS",
    captionPosition: "bottom",
    captionKaraoke: false,
    topicThemes: [
      "life-changing moments",
      "unexpected twists",
      "the kindness of strangers",
      "lessons learned",
      "user-submitted stories",
    ],
  },
};

/** Look up the full creative profile for a preset niche. "custom" has no stored
 *  profile — it must arrive via a ContentBrief (see src/studio/content-brief.ts). */
export function getNicheProfile(niche: Niche): NicheProfile {
  if (niche === "custom") {
    throw new Error(
      'The "custom" niche has no stored profile — run it through a ContentBrief (studio:brief).',
    );
  }
  return NICHE_PROFILES[niche];
}
