/**
 * THEME INTELLIGENCE — turns a free-text theme ("the goals", "funny moments",
 * "emotional bits") into a concrete clipping PLAN: which signals to trust, how
 * long clips should be, and what extra guidance the selector model needs.
 *
 * Why this exists: a football goal and a heartfelt confession are found in
 * completely different ways. A goal is a CROWD ROAR followed by replay cuts and
 * is ~15s long; an emotional moment is a slow speech passage with no loudness
 * spike at all and needs ~35s to land. Feeding both through one generic prompt
 * produced mediocre clips for both. The plan below is deterministic (no AI call,
 * no cost) and drives selection, trimming, and rendering.
 */

/** Which signal family dominates for a theme. */
export type ClipMode =
  /** Found in what is SAID. Transcript is king. */
  | "speech"
  /** Found in what HAPPENS. Loudness + scene cuts are king, words optional. */
  | "action"
  /** Both matter (a punchline is a line + a laugh). */
  | "mixed";

/** Relative trust in each signal. Sums to ~1. */
export interface SignalWeights {
  readonly transcript: number;
  readonly loudness: number;
  readonly scene: number;
}

/** Target clip length for this theme, in seconds. */
export interface DurationTarget {
  readonly min: number;
  readonly ideal: number;
  readonly max: number;
}

export interface ThemePlan {
  /** The raw theme the user typed (trimmed; "auto" when blank). */
  readonly theme: string;
  /** Which known family it matched. */
  readonly family: ThemeFamily;
  readonly mode: ClipMode;
  readonly weights: SignalWeights;
  readonly duration: DurationTarget;
  /**
   * Seconds of context BEFORE a detected peak to include. A goal needs the
   * build-up play; a punchline needs the set-up line.
   */
  readonly preRollSeconds: number;
  /** Seconds AFTER the peak — the celebration, the laughter, the reaction. */
  readonly postRollSeconds: number;
  /** Whether scene-cut detection is worth its decode cost for this theme. */
  readonly needsSceneDetection: boolean;
  /** Extra instruction injected into the selector's prompt. */
  readonly guidance: string;
  /** Caption preset that suits the theme. */
  readonly captionPreset: "bold-yellow" | "clean-white" | "impact-red";
}

export type ThemeFamily =
  | "sports-action"
  | "comedy"
  | "emotional"
  | "insight"
  | "conflict"
  | "reaction"
  | "story"
  | "quote"
  | "auto";

/**
 * Keyword table. Deliberately heuristic and deterministic — an AI call to
 * classify the theme would cost money and latency on every single job for a
 * decision this table gets right nearly always. Unknown themes fall through to
 * "auto", which is balanced and safe.
 *
 * Each family has TWO groups, and the split matters. Stems in the first group
 * match any suffix (`insight` -> insights, `laugh` -> laughing, `motivat` ->
 * motivational), because users type plurals and gerunds constantly and an exact
 * match quietly loses them. The second group is matched whole, and exists for
 * short or ambiguous tokens where open-ended matching backfires — "ko" would
 * otherwise match "know", and "td" would match "today".
 */
const FAMILY_PATTERNS: ReadonlyArray<readonly [ThemeFamily, RegExp]> = [
  [
    "sports-action",
    pattern(
      "goal|scor|dunk|touchdown|knock ?out|finish|save|tackl|assist|wicket|penalt|free ?kick|" +
        "header|golazo|highlight|clutch|dribbl|skill|nutmeg|red card|yellow card|celebrat",
      "ko|td|try|tries|play|plays|var|six|sixes",
    ),
  ],
  [
    "comedy",
    pattern(
      "funn|laugh|joke|humor|humour|comed|hilarious|banter|roast|savage|meme|punch ?line|giggl",
      "lol|bit|bits|gag|gags",
    ),
  ],
  [
    "emotional",
    pattern(
      "emotion|cry|cried|crying|tear|heartfelt|moving|touching|inspir|motivat|vulnerab|honest|" +
        "powerful|wholesome|goosebump|sad|grief|gratitude",
      "raw|deep",
    ),
  ],
  [
    "insight",
    pattern(
      "tip|insight|lesson|advice|takeaway|teach|tutorial|explain|strateg|framework|educational|" +
        "learn|breakdown|how ?to",
      "key point|key points|value|values",
    ),
  ],
  [
    "conflict",
    pattern(
      "argu|debat|clash|disagree|heated|confront|drama|beef|tension|interrupt|accus",
      "fight|fights|call out|called out|call-out",
    ),
  ],
  [
    "reaction",
    pattern("reaction|react|shock|surpris|unexpected|unbelievab|jaw ?drop", "wow|crazy|insane|wild|twist"),
  ],
  ["story", pattern("story|stories|anecdote|experience|journey|backstory", "told|telling|origin")],
  ["quote", pattern("quot|soundbite|sound ?bite|one ?liner|motto|mantra", "line|lines")],
];

/**
 * Build a family matcher: `stems` match any word starting with them, `exact`
 * must match the whole word.
 */
function pattern(stems: string, exact: string): RegExp {
  return new RegExp(`\\b(?:(?:${stems})\\w*|(?:${exact}))\\b`, "iu");
}

const PLANS: Readonly<Record<ThemeFamily, Omit<ThemePlan, "theme" | "family">>> = {
  /**
   * GOALS / SPORTS. The giveaway is a sustained crowd ROAR, almost always
   * followed by a burst of replay cuts. Words barely matter (commentary is often
   * a single shout, or the reel is music-only). Clips are SHORT — a goal plus
   * celebration is over in 15s and padding it kills retention.
   */
  "sports-action": {
    mode: "action",
    weights: { transcript: 0.15, loudness: 0.5, scene: 0.35 },
    duration: { min: 8, ideal: 16, max: 30 },
    preRollSeconds: 9,
    postRollSeconds: 5,
    needsSceneDetection: true,
    captionPreset: "impact-red",
    guidance:
      "This is ACTION content. The moment is a crowd roar / commentary shout, and the " +
      "pay-off lands a beat AFTER the build-up play. Start ~8-10s BEFORE the roar so the " +
      "viewer sees the move that created it, and end ~4-6s after so the celebration lands. " +
      "Replay cuts right after a roar confirm a real highlight — prefer those. Keep clips " +
      "SHORT (12-20s); a padded goal clip loses viewers. If commentary is sparse or absent, " +
      "trust the loud moments and scene-cut bursts over the transcript.",
  },

  /**
   * COMEDY. A laugh is a SHORT spike, and it comes after the line that caused
   * it. We must include the set-up or the clip is nonsense.
   */
  comedy: {
    mode: "mixed",
    weights: { transcript: 0.5, loudness: 0.35, scene: 0.15 },
    duration: { min: 10, ideal: 22, max: 45 },
    preRollSeconds: 14,
    postRollSeconds: 4,
    needsSceneDetection: false,
    captionPreset: "bold-yellow",
    guidance:
      "This is COMEDY. A laugh spike marks the PUNCHLINE, not the clip start — the set-up " +
      "that makes it funny comes before it. Always include the full set-up→punchline→reaction " +
      "arc, then stop quickly once the laugh dies. A punchline with no set-up is worthless. " +
      "Skip moments that are only funny with outside context.",
  },

  /**
   * EMOTIONAL. No loudness spike at all — often the OPPOSITE (a quiet, slow
   * passage). This is pure transcript work and needs room to breathe.
   */
  emotional: {
    mode: "speech",
    weights: { transcript: 0.8, loudness: 0.1, scene: 0.1 },
    duration: { min: 18, ideal: 38, max: 70 },
    preRollSeconds: 4,
    postRollSeconds: 3,
    needsSceneDetection: false,
    captionPreset: "clean-white",
    guidance:
      "This is EMOTIONAL content. Do NOT rely on loud moments — the strongest emotional beats " +
      "are usually QUIET: a voice breaking, a long pause, a confession, a turning point. Look " +
      "for vulnerability, stakes, regret, gratitude, or a hard-won realisation. Give the moment " +
      "ROOM: include the sentence that sets up why it matters, and let it finish. A rushed " +
      "emotional clip has no impact.",
  },

  insight: {
    mode: "speech",
    weights: { transcript: 0.85, loudness: 0.08, scene: 0.07 },
    duration: { min: 20, ideal: 42, max: 75 },
    preRollSeconds: 3,
    postRollSeconds: 2,
    needsSceneDetection: false,
    captionPreset: "clean-white",
    guidance:
      "This is EDUCATIONAL content. Pick moments that deliver ONE complete, self-contained idea " +
      "a viewer can act on. The clip must contain the claim AND its payoff/explanation — a tip " +
      "with no substance behind it is filler. Prefer concrete numbers, steps, and counter-intuitive " +
      "statements over general encouragement.",
  },

  conflict: {
    mode: "speech",
    weights: { transcript: 0.7, loudness: 0.22, scene: 0.08 },
    duration: { min: 18, ideal: 36, max: 70 },
    preRollSeconds: 8,
    postRollSeconds: 4,
    needsSceneDetection: false,
    captionPreset: "impact-red",
    guidance:
      "This is CONFLICT content. Find the moment the disagreement IGNITES — an interruption, a " +
      "direct challenge, a flat contradiction. Include the claim that triggered it and at least " +
      "one real exchange back. A clip that cuts before the comeback is unsatisfying.",
  },

  reaction: {
    mode: "mixed",
    weights: { transcript: 0.45, loudness: 0.4, scene: 0.15 },
    duration: { min: 10, ideal: 20, max: 40 },
    preRollSeconds: 10,
    postRollSeconds: 5,
    needsSceneDetection: true,
    captionPreset: "bold-yellow",
    guidance:
      "This is REACTION content. The clip is: the SET-UP (what was revealed/shown) immediately " +
      "followed by the REACTION to it. Both halves are mandatory — a reaction with no reveal is " +
      "meaningless. Loud spikes usually mark the reaction itself, so start well before them.",
  },

  story: {
    mode: "speech",
    weights: { transcript: 0.9, loudness: 0.05, scene: 0.05 },
    duration: { min: 30, ideal: 55, max: 85 },
    preRollSeconds: 3,
    postRollSeconds: 3,
    needsSceneDetection: false,
    captionPreset: "clean-white",
    guidance:
      "This is STORYTELLING. A clip must be a COMPLETE arc: situation → complication → resolution. " +
      "Start where the story starts, not mid-way. If a story cannot fit in the max duration, skip " +
      "it rather than truncating it.",
  },

  quote: {
    mode: "speech",
    weights: { transcript: 0.9, loudness: 0.06, scene: 0.04 },
    duration: { min: 8, ideal: 16, max: 30 },
    preRollSeconds: 3,
    postRollSeconds: 2,
    needsSceneDetection: false,
    captionPreset: "bold-yellow",
    guidance:
      "Find sharp, QUOTABLE lines that stand alone with zero context — the kind people screenshot. " +
      "Keep clips tight around the line itself plus the minimum framing needed. Cut hard once the " +
      "line lands.",
  },

  auto: {
    mode: "mixed",
    weights: { transcript: 0.55, loudness: 0.3, scene: 0.15 },
    duration: { min: 12, ideal: 32, max: 70 },
    preRollSeconds: 8,
    postRollSeconds: 4,
    needsSceneDetection: false,
    captionPreset: "bold-yellow",
    guidance:
      "No specific theme was given. Pick the moments with the highest standalone pull: surprising " +
      "claims, strong emotion, big reactions, sharp insight, or visible action. Spread picks across " +
      "the whole video rather than clustering them.",
  },
};

/** Classify a free-text theme into a family. */
export function classifyTheme(theme: string): ThemeFamily {
  const text = theme.trim().toLowerCase();
  if (text === "" || text === "auto" || text === "any" || text === "best") return "auto";
  for (const [family, pattern] of FAMILY_PATTERNS) {
    if (pattern.test(text)) return family;
  }
  return "auto";
}

/**
 * Build the full plan for a theme. Pure, deterministic, free — safe to call
 * anywhere (including tests) with no API keys.
 */
export function planForTheme(rawTheme: string): ThemePlan {
  const theme = rawTheme.trim() === "" ? "auto" : rawTheme.trim();
  const family = classifyTheme(theme);
  return { theme, family, ...PLANS[family] };
}

/**
 * When the theme is specific but the source has (almost) no speech — a music-only
 * highlight reel, for example — selection must run on audio + scene signals
 * alone. This decides when we are in that situation.
 *
 * Threshold reasoning: natural speech runs 120-160 words/minute. Below ~25 wpm
 * the "transcript" is a few stray shouts or song lyrics, not usable narration.
 */
export const SPARSE_SPEECH_WPM = 25;

export function isSparseSpeech(wordCount: number, durationSeconds: number): boolean {
  if (durationSeconds <= 0) return wordCount === 0;
  const wpm = wordCount / (durationSeconds / 60);
  return wpm < SPARSE_SPEECH_WPM;
}

/**
 * Effective mode for a job: a speech-led theme degrades to action mode when the
 * source has no usable speech, instead of returning zero clips (which is what
 * the old pipeline did on music-only reels).
 */
export function effectiveMode(plan: ThemePlan, wordCount: number, durationSeconds: number): ClipMode {
  if (isSparseSpeech(wordCount, durationSeconds)) return "action";
  return plan.mode;
}
