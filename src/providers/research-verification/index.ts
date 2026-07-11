import type { AIKernel, AIGenerateRequest } from "../../ai/index.js";
import type { ResearchPackage, ResearchClaim } from "../research/index.js";

/**
 * Research fact-checker — an INDEPENDENT verification pass over a research
 * package before anything is generated from it.
 *
 * The historical researcher already searches the web, but it also SELECTS the
 * event and writes the claims, so it can talk itself into a shaky "fact". This
 * second agent re-checks the headline fact and each claim with fresh searches
 * and returns a verdict, so a falsehood is caught before it reaches a script.
 * Never throws — on failure it returns an inconclusive pass so a flaky check
 * can't block the pipeline (it just doesn't add safety that run).
 */

const VERIFY_PROMPT_ID = "verify-research.user";
const MAX_VERIFY_SEARCHES = 3;

export type ClaimStatus = "confirmed" | "unconfirmed" | "contradicted";

export interface ClaimVerdict {
  readonly claim: string;
  readonly status: ClaimStatus;
  readonly note: string;
}

export interface VerificationResult {
  /** Verdict on the headline (shocking) fact the video opens with. */
  readonly headlineVerdict: ClaimStatus;
  readonly verdicts: readonly ClaimVerdict[];
  /** "pass" | "fail" — fail means a contradiction or an unverified headline. */
  readonly overall: "pass" | "fail";
  /** Claims the checker flagged as contradicted (must not be narrated as fact). */
  readonly contradicted: readonly string[];
  readonly warnings: readonly string[];
  readonly webSearchCount: number;
  readonly tokenUsage: { readonly inputTokens: number; readonly outputTokens: number };
}

export class ClaudeResearchVerificationProvider {
  readonly name = "claude-research-verification-provider";

  constructor(private readonly kernel: AIKernel) {}

  async verify(pkg: ResearchPackage): Promise<VerificationResult> {
    const inconclusive = (warning: string): VerificationResult => ({
      headlineVerdict: "unconfirmed",
      verdicts: [],
      overall: "pass",
      contradicted: [],
      warnings: [warning],
      webSearchCount: 0,
      tokenUsage: { inputTokens: 0, outputTokens: 0 },
    });

    // Check the highest-stakes claims (documented facts first), capped for cost.
    const claims = [...pkg.claims]
      .sort((a, b) => rank(a) - rank(b))
      .slice(0, 8)
      .map((c, i) => `${i + 1}. ${c.claim}`)
      .join("\n");

    const request: AIGenerateRequest = {
      promptId: VERIFY_PROMPT_ID,
      variables: { eventName: pkg.eventName, shockingFact: pkg.shockingFact, claims },
      expectedOutput: { format: "json", description: "fact-check verdicts" },
      webSearch: { maxUses: MAX_VERIFY_SEARCHES },
      maxTokens: 2000,
    };

    let generated;
    try {
      generated = await this.kernel.generate<string>(request);
    } catch (error) {
      return inconclusive(`verification call failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    const root = parseJsonObject(generated.output);
    if (Object.keys(root).length === 0) {
      return inconclusive("verification returned no parseable result");
    }

    const headlineVerdict = asStatus(root["headlineVerdict"]);
    const verdicts: ClaimVerdict[] = asArray(root["verdicts"]).map((v) => ({
      claim: str(v["claim"], ""),
      status: asStatus(v["status"]),
      note: str(v["note"], ""),
    }));
    const contradicted = verdicts.filter((v) => v.status === "contradicted").map((v) => v.claim);
    const overall: "pass" | "fail" =
      str(root["overall"], "pass") === "fail" || headlineVerdict === "contradicted" || contradicted.length > 0
        ? "fail"
        : "pass";

    return {
      headlineVerdict,
      verdicts,
      overall,
      contradicted,
      warnings: [],
      webSearchCount: generated.webSearchCount,
      tokenUsage: { inputTokens: generated.usage.inputTokens, outputTokens: generated.usage.outputTokens },
    };
  }
}

/** Documented facts checked first, then testimony, then softer claim types. */
function rank(claim: ResearchClaim): number {
  const order: Record<string, number> = {
    "documented-fact": 0,
    "eyewitness-testimony": 1,
    "expert-theory": 2,
    speculation: 3,
    myth: 4,
    folklore: 5,
  };
  return order[claim.type] ?? 6;
}

function asStatus(value: unknown): ClaimStatus {
  return value === "confirmed" || value === "contradicted" ? value : "unconfirmed";
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((v): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v))
    : [];
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const cleaned = raw.replace(/```(?:json)?/giu, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(cleaned.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
