import type { BaseAgent } from "../base-agent.js";

/** Converts a script into a spoken-audio file. */
export interface VoiceoverInput {
  readonly script: string;
}

export interface VoiceoverOutput {
  /** Where the generated audio lives (local path or remote URL). */
  readonly audioLocation: string;
  readonly durationSeconds: number;
}

export interface VoiceoverAgent extends BaseAgent<VoiceoverInput, VoiceoverOutput> {
  readonly name: "voiceover-agent";
}
