import type { ContentPlan } from "../content-planning/index.js";

/**
 * Narrative types — the request/response shapes a narrative provider speaks.
 *
 * A NarrativeScript is the TIMED, spoken version of a ContentPlan: the exact
 * words to say, broken into segments on a 0→~60s timeline, each tagged with an
 * emotion and a visual hint. It is the single artifact the whole back half of
 * the pipeline (Voice, Captions, Storyboard, QA, Video Composition) consumes.
 */

/** The fixed production context the ContentPlan doesn't carry. */
export interface NarrativeContext {
  readonly language: string;
  readonly platform: string;
  readonly targetDurationSeconds: number;
  /**
   * Override the scriptwriter's system prompt (role + rules). Lets a niche swap
   * in its own persona — e.g. scary stories open on a verified shocking fact and
   * may never invent details.
   */
  readonly systemPromptId?: string;
  /**
   * The word window the script must land in. Supplied by the caller because the
   * right budget depends on how fast this niche's VOICE actually speaks — a slow
   * onyx delivery needs far fewer words than a fast one for the same duration.
   * When absent, a medium-pace estimate is used.
   */
  readonly minWords?: number;
  readonly maxWords?: number;
}

/** What the caller asks the narrator to turn into a script. */
export interface NarrativeRequest {
  /** The approved content plan this narration must follow. */
  readonly contentPlan: ContentPlan;
  /** Optional per-call overrides of the provider's default context. */
  readonly context?: Partial<NarrativeContext>;
}

/** One spoken beat on the timeline. */
export interface NarrativeSegment {
  readonly startSecond: number;
  readonly endSecond: number;
  /** The exact words to be spoken. */
  readonly text: string;
  /** A single-word delivery emotion (e.g. "curious", "reassuring"). */
  readonly emotion: string;
  /** A short on-screen visual suggestion for this beat. */
  readonly visualHint: string;
  /**
   * A GENERIC 2-4 word stock-footage search phrase for this beat — a real,
   * filmable scene with NO brand names, product names, or proper nouns (so it
   * matches free stock libraries). Optional: absent on older/synthetic scripts.
   */
  readonly stockKeyword?: string;
}

/** Tokens + timing + routing recorded for one narration generation. */
export interface NarrativeMetadata {
  readonly promptId: string;
  readonly promptVersion: string;
  readonly provider: string;
  readonly model: string;
  readonly tokenUsage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
  };
  readonly latencyMs: number;
}

/**
 * NarrativeScript — the strongly-typed, timed narration.
 *
 * `warnings` records anything the parser had to fall back on (missing/invalid
 * fields, non-contiguous timeline), so a broken script is never silently
 * accepted. `metadata` carries token usage / latency for observability.
 */
export interface NarrativeScript {
  readonly hook: string;
  readonly segments: readonly NarrativeSegment[];
  readonly callToAction: string;
  readonly estimatedDurationSeconds: number;
  readonly warnings: readonly string[];
  readonly metadata: NarrativeMetadata;
}
