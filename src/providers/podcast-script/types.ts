import type { ResearchResult } from "../research/index.js";

/**
 * Podcast script types — the dialogue stage of the podcast format.
 *
 * Instead of one narrator, a podcast has a CAST (two hosts with distinct voices,
 * delivery styles, and visual personas) and TURNS (who says what, in order). The
 * runner maps turns onto the shared timeline, synthesizes each turn in that
 * host's voice, and cuts visuals to whoever is speaking.
 */

export interface PodcastCastMember {
  /** Short first name used as the speaker label (e.g. "Maya"). */
  readonly name: string;
  /** OpenAI TTS voice id — the two hosts always differ. */
  readonly voice: string;
  /** Delivery style for the TTS engine. */
  readonly voiceInstructions: string;
  /** One-line visual description for the studio shots. */
  readonly persona: string;
}

export interface PodcastTurn {
  /** Must match a cast member's name. */
  readonly speaker: string;
  readonly text: string;
  readonly emotion: string;
}

export interface PodcastScriptRequest {
  readonly topic: string;
  readonly research: ResearchResult;
  readonly tone: string;
  readonly audience: string;
  readonly language: string;
  readonly minWords: number;
  readonly maxWords: number;
}

export type PodcastScriptWarningCode = "parse-error" | "missing-field" | "bad-cast" | "bad-speaker";

export interface PodcastScriptWarning {
  readonly code: PodcastScriptWarningCode;
  readonly message: string;
}

export interface PodcastScriptMetadata {
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

export interface PodcastScript {
  readonly cast: readonly [PodcastCastMember, PodcastCastMember];
  readonly turns: readonly PodcastTurn[];
  readonly totalWords: number;
  readonly warnings: readonly PodcastScriptWarning[];
  readonly metadata: PodcastScriptMetadata;
}
