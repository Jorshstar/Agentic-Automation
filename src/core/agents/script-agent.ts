import type { BaseAgent } from "../base-agent.js";
import type { Niche } from "../../types/index.js";
import type { ResearchOutput } from "./research-agent.js";

/** Turns research into a 60-second narration script. */
export interface ScriptInput {
  readonly niche: Niche;
  readonly research: ResearchOutput;
}

export interface ScriptOutput {
  readonly title: string;
  readonly hook: string;
  readonly script: string;
  readonly callToAction: string;
}

export interface ScriptAgent extends BaseAgent<ScriptInput, ScriptOutput> {
  readonly name: "script-agent";
}
