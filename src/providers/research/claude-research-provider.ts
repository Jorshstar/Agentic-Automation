import type { AIKernel, AIGenerateRequest } from "../../ai/index.js";
import type { ResearchProvider } from "./research-provider.js";
import type {
  ResearchRequest,
  ResearchProviderResult,
  TopicValidation,
  SummarizeRequest,
  SummarizeResult,
  ResearchResult,
  ResearchReference,
  ResearchContext,
  ResearchPackage,
} from "./types.js";
import { HISTORICAL_ERAS, CLAIM_TYPES } from "./types.js";

/**
 * ClaudeResearchProvider — the first REAL research provider.
 *
 * It implements the exact same `ResearchProvider` interface the mock did, so the
 * ResearchAgent is swapped onto it with ZERO agent changes. Its ONLY route to AI
 * is `AIKernel.generate()` — it never imports the Anthropic SDK, never writes a
 * prompt string (it selects the managed prompt by id), never names a model (the
 * prompt's metadata does), and never makes an HTTP call.
 *
 *   ResearchAgent → ResearchProvider (this) → AIKernel.generate() → Claude
 */

/**
 * The prompts this provider drives (TEXT lives in the Prompt Management System):
 *   - `research.system` — the role + rules (search first, never invent facts)
 *   - `research.user`   — the task for one topic
 */
const RESEARCH_SYSTEM_PROMPT_ID = "research.system";
const RESEARCH_USER_PROMPT_ID = "research.user";

/** The historical-research persona (scary niche): picks + verifies a real event. */
const HISTORICAL_SYSTEM_PROMPT_ID = "research-scary.system";
const HISTORICAL_USER_PROMPT_ID = "research-scary.user";

/** Cap on live searches per topic. ~$0.01 each, so this bounds research cost. */
const MAX_WEB_SEARCHES = 4;
/**
 * Historical research picks AND verifies an event. Each search dumps its results
 * into the context window, so this cap controls INPUT TOKENS far more than the
 * $0.01/search fee — 8 searches cost ~$0.68 a run, 5 keeps it near $0.30.
 */
const MAX_HISTORICAL_SEARCHES = 3;

/** Sensible defaults for the context the agent doesn't provide. */
const DEFAULT_RESEARCH_CONTEXT: ResearchContext = {
  audience: "General Audience",
  tone: "Educational",
  language: "English",
  platform: "YouTube Shorts",
};

export class ClaudeResearchProvider implements ResearchProvider {
  readonly name = "claude-research-provider";

  /** The rich result of the most recent research call (for demos/telemetry). */
  private lastRichResult: ResearchResult | undefined;

  constructor(
    private readonly kernel: AIKernel,
    private readonly context: ResearchContext = DEFAULT_RESEARCH_CONTEXT,
  ) {}

  /** The full structured result of the last `researchTopic` call, if any. */
  get lastResult(): ResearchResult | undefined {
    return this.lastRichResult;
  }

  /**
   * The interface method the agent calls. Runs the real AI research, then maps
   * the rich {@link ResearchResult} down to the {@link ResearchProviderResult}
   * shape the agent already understands — so the agent stays unchanged.
   */
  async researchTopic(request: ResearchRequest): Promise<ResearchProviderResult> {
    const rich = await this.research(request);
    return {
      summary: rich.summary,
      keyPoints: rich.keyPoints,
      keywords: request.keywords ?? [],
      sources: rich.references.map((reference) => ({
        title: reference.title,
        url: reference.url ?? "",
      })),
      // Fewer parser warnings ⇒ higher confidence. Simple, deterministic.
      confidence: rich.warnings.length === 0 ? 0.9 : 0.6,
    };
  }

  /**
   * The rich path: build a normalized AI request, call the ONE kernel entry
   * point, and parse the generated text into a structured ResearchResult.
   */
  async research(request: ResearchRequest): Promise<ResearchResult> {
    if (request.historical) {
      return this.researchHistorical(request);
    }

    const generateRequest: AIGenerateRequest = {
      promptId: RESEARCH_USER_PROMPT_ID,
      systemPromptId: RESEARCH_SYSTEM_PROMPT_ID,
      variables: {
        topic: request.topic,
        audience: this.context.audience,
        tone: this.context.tone,
        language: this.context.language,
        platform: this.context.platform,
      },
      expectedOutput: { format: "text", description: "a concise research briefing" },
      // Live web search: the model reads real pages and the API returns real
      // citations, so `references` are actual sources, not text the model made up.
      webSearch: { maxUses: MAX_WEB_SEARCHES },
      // Searching + reasoning + the briefing all share this budget; 700 (the old
      // no-search value) truncates the answer before the briefing is written.
      maxTokens: 2500,
    };

    const generated = await this.kernel.generate<string>(generateRequest);
    const parsed = parseResearchText(generated.output);

    // Sources come from the API's citations (verified), not from regexing URLs
    // out of prose. Fall back to any URLs in the text if no search ran.
    const references: readonly ResearchReference[] =
      generated.citations.length > 0
        ? generated.citations.map((c) => ({ title: c.title, url: c.url }))
        : parsed.references;

    const warnings = [
      ...parsed.warnings.filter((w) => !w.startsWith("The model output contained no source URLs")),
      ...(references.length === 0 ? ["Research produced no cited sources."] : []),
    ];

    const result: ResearchResult = {
      summary: parsed.summary,
      keyPoints: parsed.keyPoints,
      references,
      warnings,
      metadata: {
        promptId: generated.promptId,
        promptVersion: generated.promptVersion,
        provider: generated.provider,
        model: generated.model,
        tokenUsage: {
          inputTokens: generated.usage.inputTokens,
          outputTokens: generated.usage.outputTokens,
          totalTokens: generated.usage.totalTokens,
        },
        latencyMs: generated.latencyMs,
        webSearchCount: generated.webSearchCount,
      },
    };

    this.lastRichResult = result;
    return result;
  }

  /**
   * The HISTORICAL path (scary niche). The researcher SELECTS a real event
   * (unless one is assigned), verifies it with live web search, and returns a
   * structured {@link ResearchPackage} — every claim tagged with how it is
   * evidenced. Hard rotation bans are passed in as forbidden countries/eras.
   */
  private async researchHistorical(request: ResearchRequest): Promise<ResearchResult> {
    const generateRequest: AIGenerateRequest = {
      promptId: HISTORICAL_USER_PROMPT_ID,
      systemPromptId: HISTORICAL_SYSTEM_PROMPT_ID,
      variables: {
        directive: request.topic.trim() === "" ? "none" : request.topic,
        avoidTopics: joinOrNone(request.avoidTopics),
        avoidCountries: joinOrNone(request.avoidCountries),
        avoidEras: joinOrNone(request.avoidEras),
      },
      expectedOutput: { format: "json", description: "a historical research package" },
      // Picking + verifying an event takes more searches than a plain briefing.
      webSearch: { maxUses: MAX_HISTORICAL_SEARCHES },
      // The package is large (timeline + theories + graded claims). Too small a
      // budget truncates the JSON mid-object and the whole run loses the event.
      maxTokens: 8000,
    };

    const generated = await this.kernel.generate<string>(generateRequest);
    const warnings: string[] = [];
    const pkg = parsePackage(generated.output, warnings);

    // Sources = the URLs the model says it used for THIS event, VERIFIED against
    // the pages the search actually fetched. That drops both hallucinated URLs
    // and the pages it explored for other events and discarded.
    const fetched = new Map(generated.searchResults.map((r) => [normalizeUrl(r.url), r]));
    const verified: ResearchReference[] = [];
    for (const listed of pkg.sources) {
      const match = fetched.get(normalizeUrl(listed));
      if (match) {
        verified.push({ title: match.title, url: match.url });
      }
    }

    let references: readonly ResearchReference[] = verified;
    if (references.length === 0) {
      // Prose citations (rare for JSON answers) are the next-best real evidence.
      references = generated.citations.map((c) => ({ title: c.title, url: c.url }));
    }
    if (references.length === 0) {
      warnings.push("Research produced no verifiable sources for the chosen event.");
    }

    const result: ResearchResult = {
      summary: pkg.summary,
      keyPoints: pkg.keyPoints,
      references,
      warnings,
      package: pkg.package,
      metadata: {
        promptId: generated.promptId,
        promptVersion: generated.promptVersion,
        provider: generated.provider,
        model: generated.model,
        tokenUsage: {
          inputTokens: generated.usage.inputTokens,
          outputTokens: generated.usage.outputTokens,
          totalTokens: generated.usage.totalTokens,
        },
        latencyMs: generated.latencyMs,
        webSearchCount: generated.webSearchCount,
      },
    };
    this.lastRichResult = result;
    return result;
  }

  /** Cheap, local topic sanity check — no AI needed. */
  async validateTopic(topic: string): Promise<TopicValidation> {
    const trimmed = topic.trim();
    const issues: string[] = [];
    if (trimmed.length === 0) {
      issues.push("Topic is empty.");
    } else if (trimmed.length < 3) {
      issues.push("Topic is too short to research.");
    }
    return { valid: issues.length === 0, issues };
  }

  /**
   * Simple local condense. There is no dedicated summarise prompt yet, so this
   * stays deterministic (no AI). It still touches NO vendor SDK or HTTP.
   */
  async summarize(request: SummarizeRequest): Promise<SummarizeResult> {
    const words = request.text.trim().split(/\s+/u);
    const limit = request.maxWords ?? 40;
    return { summary: words.slice(0, limit).join(" ") };
  }
}

/** Parsed pieces of the model's raw research text (parsing kept deliberately simple). */
interface ParsedResearch {
  readonly summary: string;
  readonly keyPoints: readonly string[];
  readonly references: readonly ResearchReference[];
  readonly warnings: readonly string[];
}

/**
 * Turn the model's raw text into structured research. Intentionally forgiving:
 *   - key points  = lines that start with a bullet ("-", "*", "•") or "1." / "1)"
 *   - references  = any http(s) URLs found in the text
 *   - summary     = the first real paragraph (skipping markdown headings, stopping
 *                   at the key-points list)
 * Anything the parser can't produce cleanly becomes a warning, never a silent gap.
 */
function parseResearchText(raw: string): ParsedResearch {
  const text = raw.trim();
  const warnings: string[] = [];
  const lines = text.split(/\r?\n/u);

  const isBullet = (line: string): boolean => /^\s*(?:[-*•]|\d+[.)])\s+/u.test(line);

  const keyPoints: string[] = [];
  for (const line of lines) {
    const match = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*\S)/u);
    const point = match?.[1]?.trim();
    if (point) {
      keyPoints.push(point);
    }
  }

  const references: ResearchReference[] = [];
  for (const url of text.match(/https?:\/\/[^\s)]+/gu) ?? []) {
    references.push({ title: url, url });
  }

  // Summary = the paragraph DIRECTLY ABOVE the key-points list.
  //
  // Taking the *first* paragraph is wrong: when web search runs, the model can
  // prepend narration ("I have enough data to write the briefing.") before the
  // real summary. The briefing's shape is fixed — summary, blank line, bullets —
  // so we anchor on the bullets and walk back over the paragraph above them,
  // which skips any number of narration paragraphs.
  const firstBullet = lines.findIndex((line) => isBullet(line));
  const summary = firstBullet > 0 ? paragraphAbove(lines, firstBullet) : firstParagraph(lines, text);

  if (text.length === 0) {
    warnings.push("The model returned empty content.");
  }
  if (keyPoints.length === 0) {
    warnings.push("No key points could be parsed from the model output.");
  }
  if (references.length === 0) {
    warnings.push("The model output contained no source URLs.");
  }

  return { summary, keyPoints, references, warnings };
}

/* -------------------------- historical package parse -------------------------- */

interface ParsedPackage {
  readonly summary: string;
  readonly keyPoints: readonly string[];
  /** The model's own source list — unverified, used only as a last resort. */
  readonly sources: readonly string[];
  readonly package?: ResearchPackage;
}

/**
 * Parse the historical JSON package. Defensive throughout: a malformed field
 * degrades to a safe value with a warning; a totally unparseable response
 * yields no package (the run then surfaces the warnings rather than crashing).
 */
function parsePackage(raw: string, warnings: string[]): ParsedPackage {
  const root = parseJsonObject(raw, warnings);
  if (Object.keys(root).length === 0) {
    return { summary: raw.trim().slice(0, 500), keyPoints: [], sources: [] };
  }

  const eventName = str(root["eventName"], "");
  const summary = str(root["summary"], "");
  const keyPoints = strArray(root["keyPoints"]);
  if (eventName === "") {
    warnings.push("Research package has no event name.");
  }
  if (keyPoints.length === 0) {
    warnings.push("Research package has no key points.");
  }

  const pkg: ResearchPackage = {
    eventName,
    period: str(root["period"], "unknown"),
    country: str(root["country"], "unknown"),
    era: oneOf(root["era"], HISTORICAL_ERAS, "modern", "era", warnings),
    location: str(root["location"], "unknown"),
    peopleInvolved: strArray(root["peopleInvolved"]),
    background: str(root["background"], ""),
    timeline: objArray(root["timeline"], (r) => ({
      when: str(r["when"], "unknown"),
      what: str(r["what"], ""),
    })),
    officialExplanation: str(root["officialExplanation"], "unknown"),
    alternativeTheories: objArray(root["alternativeTheories"], (r) => ({
      theory: str(r["theory"], ""),
      proponents: str(r["proponents"], "unknown"),
      evidence: str(r["evidence"], "unknown"),
    })),
    whyDebated: str(root["whyDebated"], ""),
    unexplainedFacts: strArray(root["unexplainedFacts"]),
    claims: objArray(root["claims"], (r) => ({
      claim: str(r["claim"], ""),
      type: oneOf(r["type"], CLAIM_TYPES, "speculation", "claim.type", warnings),
      confidence: oneOf(r["confidence"], ["high", "medium", "low"] as const, "low", "claim.confidence", warnings),
    })).filter((c) => c.claim !== ""),
    shockingFact: str(root["shockingFact"], ""),
  };

  if (pkg.claims.length === 0) {
    warnings.push("Research package tagged no claims with evidence type/confidence.");
  }
  if (pkg.shockingFact === "") {
    warnings.push("Research package has no shocking fact for the hook.");
  }

  return {
    summary: summary || pkg.background,
    keyPoints,
    sources: strArray(root["sources"]),
    package: pkg,
  };
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
}

function strArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim() !== "") : [];
}

function objArray<T>(value: unknown, map: (record: Record<string, unknown>) => T): T[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object" && !Array.isArray(entry))
    .map(map);
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
  field: string,
  warnings: string[],
): T {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  warnings.push(`"${field}" was "${String(value)}" → "${fallback}".`);
  return fallback;
}

function parseJsonObject(raw: string, warnings: string[]): Record<string, unknown> {
  const cleaned = raw.replace(/```(?:json)?/giu, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    warnings.push("Research output did not contain a JSON object.");
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(cleaned.slice(start, end + 1));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // The most common cause is a token budget that cut the object off mid-write.
    const truncated = !cleaned.trimEnd().endsWith("}");
    warnings.push(
      truncated
        ? "Research JSON was truncated (output token budget too small)."
        : "Research output was not valid JSON.",
    );
    return {};
  }
  warnings.push("Research output JSON was not an object.");
  return {};
}

/** Compare URLs ignoring scheme, "www.", and trailing slashes. */
function normalizeUrl(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//u, "")
    .replace(/^www\./u, "")
    .replace(/\/+$/u, "");
}

function joinOrNone(values: readonly string[] | undefined): string {
  return values && values.length > 0 ? values.join("; ") : "none";
}

/** The contiguous block of text lines immediately above `index`, joined. */
function paragraphAbove(lines: readonly string[], index: number): string {
  const collected: string[] = [];
  for (let i = index - 1; i >= 0; i -= 1) {
    const line = (lines[i] ?? "").trim();
    if (line === "") {
      if (collected.length > 0) {
        break; // hit the blank line above the paragraph
      }
      continue; // skip blanks between the paragraph and the bullets
    }
    if (/^#{1,6}\s/u.test(line)) {
      continue; // ignore markdown headings
    }
    collected.unshift(line);
  }
  return collected.join(" ");
}

/** Fallback when the model produced no bullets: the first real paragraph. */
function firstParagraph(lines: readonly string[], fallback: string): string {
  const collected: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") {
      if (collected.length > 0) {
        break;
      }
      continue;
    }
    if (/^#{1,6}\s/u.test(trimmed)) {
      continue;
    }
    collected.push(trimmed);
  }
  return collected.length > 0 ? collected.join(" ") : fallback;
}
