import type { PromptVariable } from "../types.js";

/**
 * Prompt templates + a MINIMAL renderer (architecture only — not a full template
 * engine). Templates use `{{name}}` placeholders, e.g.:
 *   "Write a {{duration}}s script about {{topic}} in a {{tone}} tone."
 */

/** Values that can be injected into a template. */
export type TemplateVariables = Readonly<Record<string, PromptVariable>>;

export interface PromptTemplate {
  readonly text: string;
}

/** Return the unique placeholder names in a template (e.g. ["topic","tone"]). */
export function extractPlaceholders(text: string): readonly string[] {
  const matches = text.match(/\{\{\s*([\w.]+)\s*\}\}/gu) ?? [];
  const names = matches.map((match) => match.replace(/[{}\s]/gu, ""));
  return [...new Set(names)];
}

/** Substitute `{{name}}` with the matching variable. Simple, deliberate. */
export function renderTemplate(text: string, variables: TemplateVariables): string {
  let output = text;
  for (const [key, value] of Object.entries(variables)) {
    output = output.split(`{{${key}}}`).join(String(value));
  }
  return output;
}
