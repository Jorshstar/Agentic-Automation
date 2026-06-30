import type { BaseAgent } from "../base-agent.js";
import type { Niche } from "../../types/index.js";

/** Produces the background visuals/images for the video. */
export interface VisualAssetInput {
  readonly niche: Niche;
  readonly script: string;
}

export interface VisualAssetOutput {
  /** Locations of the generated images/clips, in order. */
  readonly imageLocations: readonly string[];
}

export interface VisualAssetAgent extends BaseAgent<VisualAssetInput, VisualAssetOutput> {
  readonly name: "visual-asset-agent";
}
