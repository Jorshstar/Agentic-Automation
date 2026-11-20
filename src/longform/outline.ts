import type { AIKernel } from "../ai/index.js";
import { createClaudeAIKernel } from "../ai/index.js";
import { textProviderOptions } from "../ai/text-provider.js";

/**
 * SERIES OUTLINE — the whole arc planned once, from the sources.
 *
 * Two problems this solves, both found by running the series without it.
 *
 * ARC. Writing each part knowing only what came BEFORE means the writer has no
 * idea where the story is going, so it cannot pace it. Part one originally
 * raced from founding to acquisition to the present day because nothing told it
 * to save anything.
 *
 * SOURCE COVERAGE. This is the one that actually degrades a series. Material
 * thins out as the story moves on: the Instagram articles are dense on the
 * founding and the acquisition, and thin on the Facebook-era internal story, so
 * part three had eight of nine beats flagged as unsupported — with the SAME
 * rate on both models tried, which is what identified the source rather than
 * the writer as the cause. A planner that reads the sources first can see that
 * coming and plan parts around the ground the source actually covers, stopping
 * when it runs out instead of padding into invention.
 *
 * So the outline's most useful output is often the part count: an honest "this
 * supports four parts" beats ten parts where six are fabricated.
 */

export interface OutlinePart {
  readonly part: number;
  readonly title: string;
  /** What this part covers, as a brief to the writer. */
  readonly covers: string;
  /** The unresolved hook it should end on. */
  readonly endsOn: string;
}

export interface SeriesOutline {
  readonly totalParts: number;
  readonly parts: readonly OutlinePart[];
  /** Why this many — usually a note on where the source runs out. */
  readonly note: string;
}

const SYSTEM_PROMPT_ID = "longform-outline.system";
const USER_PROMPT_ID = "longform-outline.user";

export class SeriesPlanner {
  private readonly kernel: AIKernel;

  constructor(kernel?: AIKernel) {
    this.kernel = kernel ?? createClaudeAIKernel();
  }

  async plan(topic: string, sourceText: string, secondsPerPart = 55): Promise<SeriesOutline> {
    const generated = await this.kernel.generate({
      promptId: USER_PROMPT_ID,
      systemPromptId: SYSTEM_PROMPT_ID,
      variables: { topic, sourceText, secondsPerPart: Math.round(secondsPerPart) },
      expectedOutput: { format: "json", description: "a series outline" },
      maxTokens: 3000,
      // Planning is quality-critical in the same way writing is: a bad outline
      // misshapes every part that follows it.
      ...textProviderOptions("LONGFORM_OUTLINE_MODEL", "LONGFORM_OUTLINE_PROVIDER"),
    });
    return parseOutline(generated.output);
  }
}

export function parseOutline(output: unknown): SeriesOutline {
  let root: unknown = output;
  if (typeof output === "string") {
    const cleaned = output.trim().replace(/^```(?:json)?/iu, "").replace(/```$/u, "").trim();
    try {
      root = JSON.parse(cleaned);
    } catch {
      return { totalParts: 0, parts: [], note: "" };
    }
  }

  const record = (root ?? {}) as Record<string, unknown>;
  const raw = Array.isArray(record["parts"]) ? record["parts"] : [];

  const parts: OutlinePart[] = [];
  for (const [index, item] of raw.entries()) {
    const entry = (item ?? {}) as Record<string, unknown>;
    const covers = typeof entry["covers"] === "string" ? entry["covers"].trim() : "";
    if (covers === "") continue; // a part with no brief is no use to the writer
    parts.push({
      part: typeof entry["part"] === "number" ? entry["part"] : index + 1,
      title: typeof entry["title"] === "string" ? entry["title"].trim() : `Part ${index + 1}`,
      covers,
      endsOn: typeof entry["endsOn"] === "string" ? entry["endsOn"].trim() : "",
    });
  }

  return {
    // Trust the parts actually returned over any count the model asserts.
    totalParts: parts.length,
    parts,
    note: typeof record["note"] === "string" ? record["note"].trim() : "",
  };
}

/** The brief for one part, or empty when the outline does not reach that far. */
export function briefForPart(outline: SeriesOutline | undefined, part: number): string {
  const slot = outline?.parts.find((entry) => entry.part === part);
  if (!slot) return "";
  return (
    `This part is planned as: ${slot.title}\n` +
    `Cover: ${slot.covers}\n` +
    (slot.endsOn ? `End on: ${slot.endsOn}\n` : "") +
    `It is part ${part} of ${outline?.totalParts ?? part}.`
  );
}
