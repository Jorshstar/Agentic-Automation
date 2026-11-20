import type { AIKernel } from "../ai/index.js";
import { createClaudeAIKernel } from "../ai/index.js";

/**
 * LONG-FORM SCRIPT — turning a topic into narrated beats with paired visuals.
 *
 * This is its own stage rather than a reuse of the narrative provider, because
 * the two want different things. A 60-second short wants a hook, a build and a
 * call to action. A documentary wants a chain of concrete, dated, checkable
 * facts delivered in a dry voice, where each beat names something that can
 * actually be DRAWN.
 *
 * That last part is the reason beats carry their own visual. Asking a separate
 * stage to invent an illustration for "and it all started to change" produces
 * generic filler; asking the writer to only make claims that have a picture
 * attached keeps the script concrete and the images specific, which is most of
 * the difference between this format and AI slop.
 */

export interface ScriptBeat {
  /** The exact words to be spoken. */
  readonly text: string;
  /**
   * What to draw for this beat: action and setting ONLY.
   *
   * Appearance cues are deliberately excluded. In the style probe a beat that
   * said "the same man, older now" made the model draw hair, a nose and blush,
   * breaking a blank-faced style that had held across seven images. Age and
   * identity come from the locked style block, never from a beat.
   */
  readonly visual: string;
}

export interface LongformScript {
  readonly title: string;
  readonly beats: readonly ScriptBeat[];
  readonly estimatedWords: number;
}

const SYSTEM_PROMPT_ID = "longform-script.system";
const USER_PROMPT_ID = "longform-script.user";

/** Narration runs near 150 words per minute. */
export const WORDS_PER_MINUTE = 150;

export interface ScriptRequest {
  readonly topic: string;
  readonly targetSeconds: number;
  /**
   * Fetched source material the script must be built from.
   *
   * Without this the writer works from memory, and a model asked about history
   * produces fluent, specific, confidently WRONG dates. With it, the job
   * becomes summary rather than recall.
   */
  readonly sourceText?: string;
}

export class LongformScriptWriter {
  private readonly kernel: AIKernel;

  constructor(kernel?: AIKernel) {
    this.kernel = kernel ?? createClaudeAIKernel();
  }

  async write(request: ScriptRequest): Promise<LongformScript> {
    const targetWords = Math.round((request.targetSeconds / 60) * WORDS_PER_MINUTE);
    // Beats run about six seconds in the reference, which is also roughly one
    // sentence of narration — so the two line up naturally.
    const beatCount = Math.max(4, Math.round(request.targetSeconds / 6));

    const generated = await this.kernel.generate({
      promptId: USER_PROMPT_ID,
      systemPromptId: SYSTEM_PROMPT_ID,
      variables: {
        topic: request.topic,
        targetSeconds: Math.round(request.targetSeconds),
        targetWords,
        beatCount,
        sourceText:
          request.sourceText && request.sourceText.trim() !== ""
            ? request.sourceText
            : "(no sources were found — say only what you are certain of, and prefer vaguer " +
              "phrasing to an invented number)",
      },
      expectedOutput: { format: "json", description: "a documentary script as beats" },
      maxTokens: 4000,
      // The studio runs on OpenAI end to end.
      provider: "openai",
      ...(process.env.LONGFORM_SCRIPT_MODEL?.trim()
        ? { model: process.env.LONGFORM_SCRIPT_MODEL.trim() }
        : {}),
    });

    return parseScript(generated.output, request.topic);
  }
}

/* -------------------------------- parsing -------------------------------- */

export function parseScript(output: unknown, topic: string): LongformScript {
  let root: unknown = output;
  if (typeof output === "string") {
    const cleaned = output.trim().replace(/^```(?:json)?/iu, "").replace(/```$/u, "").trim();
    try {
      root = JSON.parse(cleaned);
    } catch {
      return { title: topic, beats: [], estimatedWords: 0 };
    }
  }

  const record = (root ?? {}) as Record<string, unknown>;
  const rawBeats = Array.isArray(record["beats"]) ? record["beats"] : [];

  const beats: ScriptBeat[] = [];
  for (const item of rawBeats) {
    const beat = (item ?? {}) as Record<string, unknown>;
    const text = typeof beat["text"] === "string" ? beat["text"].trim() : "";
    const visual = typeof beat["visual"] === "string" ? beat["visual"].trim() : "";
    // A beat with no words is nothing to narrate; one with no visual would
    // render as a blank card, so both are required.
    if (text === "" || visual === "") continue;
    beats.push({ text, visual });
  }

  const title = typeof record["title"] === "string" && record["title"].trim() !== ""
    ? record["title"].trim()
    : topic;

  return {
    title,
    beats,
    estimatedWords: beats.reduce((sum, beat) => sum + beat.text.split(/\s+/u).length, 0),
  };
}
