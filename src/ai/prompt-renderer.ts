import type { PromptTemplate } from "./prompt-registry.js";
import type { PromptVariable } from "./types.js";

/**
 * PromptRenderer — turns a template + variables into a final prompt string.
 *
 * This is where "variable injection" happens (e.g. replacing {{topic}}). Only the
 * contract is defined here.
 */
export interface PromptRenderer {
  render(template: PromptTemplate, variables: Readonly<Record<string, PromptVariable>>): string;
}
