import type { BaseAgent } from "../base-agent.js";
import type { Niche, Platform } from "../../types/index.js";

/** Generates upload metadata (title, description, tags) for each platform. */
export interface SEOInput {
  readonly niche: Niche;
  readonly title: string;
  readonly script: string;
}

export interface SEOOutput {
  readonly title: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly hashtags: readonly string[];
  /** Platforms this metadata is tuned for. */
  readonly platforms: readonly Platform[];
}

export interface SEOAgent extends BaseAgent<SEOInput, SEOOutput> {
  readonly name: "seo-agent";
}
