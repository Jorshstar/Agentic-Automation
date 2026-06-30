import type { BaseAgent } from "../base-agent.js";

/** Stitches audio + visuals into the final vertical video. */
export interface VideoAssemblyInput {
  readonly audioLocation: string;
  readonly imageLocations: readonly string[];
  readonly script: string;
}

export interface VideoAssemblyOutput {
  /** Where the rendered 60s video lives (local path or remote URL). */
  readonly videoLocation: string;
  readonly durationSeconds: number;
}

export interface VideoAssemblyAgent extends BaseAgent<VideoAssemblyInput, VideoAssemblyOutput> {
  readonly name: "video-assembly-agent";
}
