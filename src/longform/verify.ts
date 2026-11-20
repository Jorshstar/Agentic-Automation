import type { AIKernel } from "../ai/index.js";
import { createClaudeAIKernel } from "../ai/index.js";
import type { ScriptBeat } from "./script.js";

/**
 * FACT CHECK — every claim in the script, checked back against the sources.
 *
 * Grounding the writer in fetched text reduces invention; it does not remove
 * it. A model summarising an article will still occasionally round a number to
 * something neater, merge two dates, or carry across a detail it knew already
 * and assumed was in the source. Those are precisely the errors that destroy a
 * history video's credibility, and they are invisible in the output — a wrong
 * year reads exactly like a right one.
 *
 * So this is a SECOND pass with a different job. The writer was asked to tell a
 * story; the checker is asked only whether each sentence is supported, and is
 * told that passing something unsupported is the expensive mistake. Separating
 * the two matters: asking one call to both write well and police itself gets
 * the policing done badly.
 *
 * Costs about a cent, against a video that costs a few dollars.
 */

export type ClaimVerdict = "supported" | "unsupported" | "contradicted";

export interface BeatCheck {
  readonly index: number;
  readonly verdict: ClaimVerdict;
  /** What is wrong, when it is. Empty when supported. */
  readonly problem: string;
  /** A corrected line that IS supported, when one is possible. */
  readonly correction: string;
}

export interface VerificationResult {
  readonly checks: readonly BeatCheck[];
  readonly problems: readonly BeatCheck[];
  /** The script with correctable beats replaced and uncorrectable ones dropped. */
  readonly beats: readonly ScriptBeat[];
}

const SYSTEM_PROMPT_ID = "longform-verify.system";
const USER_PROMPT_ID = "longform-verify.user";

export class ScriptVerifier {
  private readonly kernel: AIKernel;

  constructor(kernel?: AIKernel) {
    this.kernel = kernel ?? createClaudeAIKernel();
  }

  async verify(beats: readonly ScriptBeat[], sourceText: string): Promise<VerificationResult> {
    // Nothing to check against: report honestly rather than rubber-stamping.
    if (sourceText.trim() === "" || beats.length === 0) {
      return { checks: [], problems: [], beats: [...beats] };
    }

    const numbered = beats.map((beat, index) => `${index + 1}. ${beat.text}`).join("\n");

    let checks: BeatCheck[];
    try {
      const generated = await this.kernel.generate({
        promptId: USER_PROMPT_ID,
        systemPromptId: SYSTEM_PROMPT_ID,
        variables: { sourceText, beats: numbered, beatCount: beats.length },
        expectedOutput: { format: "json", description: "a verdict per beat" },
        maxTokens: 3000,
        provider: "openai",
        ...(process.env.LONGFORM_VERIFY_MODEL?.trim()
          ? { model: process.env.LONGFORM_VERIFY_MODEL.trim() }
          : {}),
      });
      checks = parseChecks(generated.output, beats.length);
    } catch {
      // A failed check must not silently become a pass. Report nothing checked
      // and let the caller decide; claiming verification that did not happen
      // would be worse than admitting it.
      return { checks: [], problems: [], beats: [...beats] };
    }

    const byIndex = new Map(checks.map((check) => [check.index, check]));
    const kept: ScriptBeat[] = [];
    for (const [index, beat] of beats.entries()) {
      const check = byIndex.get(index);
      if (!check || check.verdict === "supported") {
        kept.push(beat);
        continue;
      }
      if (check.correction.trim() !== "") {
        kept.push({ ...beat, text: check.correction.trim() });
        continue;
      }
      // Unsupported and uncorrectable: drop it. A shorter honest script beats a
      // longer one with an invented fact in it.
    }

    return {
      checks,
      problems: checks.filter((check) => check.verdict !== "supported"),
      beats: kept,
    };
  }
}

export function parseChecks(output: unknown, beatCount: number): BeatCheck[] {
  let root: unknown = output;
  if (typeof output === "string") {
    const cleaned = output.trim().replace(/^```(?:json)?/iu, "").replace(/```$/u, "").trim();
    try {
      root = JSON.parse(cleaned);
    } catch {
      return [];
    }
  }

  const record = (root ?? {}) as Record<string, unknown>;
  const raw = Array.isArray(record["checks"]) ? record["checks"] : [];

  const checks: BeatCheck[] = [];
  for (const item of raw) {
    const entry = (item ?? {}) as Record<string, unknown>;
    // The model is asked for 1-based beat numbers; store 0-based.
    const number = typeof entry["beat"] === "number" ? entry["beat"] : undefined;
    if (number === undefined || number < 1 || number > beatCount) continue;

    const rawVerdict = typeof entry["verdict"] === "string" ? entry["verdict"].toLowerCase() : "";
    const verdict: ClaimVerdict =
      rawVerdict === "unsupported" || rawVerdict === "contradicted" ? rawVerdict : "supported";

    checks.push({
      index: number - 1,
      verdict,
      problem: typeof entry["problem"] === "string" ? entry["problem"].slice(0, 300) : "",
      correction: typeof entry["correction"] === "string" ? entry["correction"].slice(0, 500) : "",
    });
  }
  return checks;
}
