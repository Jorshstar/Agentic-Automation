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
} from "./types.js";

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

/** The prompt this provider drives. The TEXT lives in the Prompt Management System. */
const RESEARCH_PROMPT_ID = "research.system";

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
    const generateRequest: AIGenerateRequest = {
      promptId: RESEARCH_PROMPT_ID,
      variables: {
        topic: request.topic,
        audience: this.context.audience,
        tone: this.context.tone,
        language: this.context.language,
        platform: this.context.platform,
      },
      expectedOutput: { format: "text", description: "a concise research briefing" },
      maxTokens: 700,
    };

    const generated = await this.kernel.generate<string>(generateRequest);
    const parsed = parseResearchText(generated.output);

    const result: ResearchResult = {
      summary: parsed.summary,
      keyPoints: parsed.keyPoints,
      references: parsed.references,
      warnings: parsed.warnings,
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

  // Summary = first non-empty paragraph, skipping markdown headings and stopping
  // when the key-points list begins.
  const summaryLines: string[] = [];
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (trimmedLine === "") {
      if (summaryLines.length > 0) {
        break; // end of the first real paragraph
      }
      continue; // skip leading blank lines
    }
    if (/^#{1,6}\s/u.test(trimmedLine)) {
      continue; // skip markdown headings (e.g. "# Research Briefing")
    }
    if (isBullet(line)) {
      break; // reached the key-points list
    }
    summaryLines.push(trimmedLine);
  }
  const summary = summaryLines.length > 0 ? summaryLines.join(" ") : text;

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
