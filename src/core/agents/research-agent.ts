import type { BaseAgent } from "../base-agent.js";
import type { Niche } from "../../types/index.js";

/** Gathers source material for the day's niche. */
export interface ResearchInput {
  readonly niche: Niche;
}

export interface ResearchOutput {
  readonly topic: string;
  readonly summary: string;
  readonly keyPoints: readonly string[];
  readonly sources: readonly string[];
}

export interface ResearchAgent extends BaseAgent<ResearchInput, ResearchOutput> {
  readonly name: "research-agent";
}
