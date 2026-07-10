/**
 * Research provider types — the request/response shapes a research provider
 * speaks. These deliberately resemble what a real AI provider would return
 * later, so swapping the mock for a real one needs no changes upstream.
 */

/** A citation backing up the research. */
export interface ResearchProviderSource {
  readonly title: string;
  readonly url: string;
}

/** What the agent asks the provider to research. */
export interface ResearchRequest {
  /** The topic/title to research. */
  readonly topic: string;
  /** Optional angle or focus for the research. */
  readonly angle?: string;
  /** Optional seed keywords to steer the research. */
  readonly keywords?: readonly string[];
}

/** What the provider returns for a research request. */
export interface ResearchProviderResult {
  readonly summary: string;
  readonly keyPoints: readonly string[];
  readonly keywords: readonly string[];
  readonly sources: readonly ResearchProviderSource[];
  /** How confident the provider is, from 0 (unsure) to 1 (certain). */
  readonly confidence: number;
}

/** The outcome of validating a topic before researching it. */
export interface TopicValidation {
  readonly valid: boolean;
  readonly issues: readonly string[];
}

/** Input for a generic summarise call. */
export interface SummarizeRequest {
  readonly text: string;
  readonly maxWords?: number;
}

/** Output of a summarise call. */
export interface SummarizeResult {
  readonly summary: string;
}

/**
 * The fixed context an AI research provider needs but the {@link ResearchRequest}
 * doesn't carry (the agent only knows the topic). Supplied to the provider at
 * construction time and fed into the prompt's required variables.
 */
export interface ResearchContext {
  readonly audience: string;
  readonly tone: string;
  readonly language: string;
  readonly platform: string;
}

/** A source/citation for a research finding (URL optional — models may omit it). */
export interface ResearchReference {
  readonly title: string;
  readonly url?: string;
}

/** Tokens + timing + routing recorded for one AI research call. */
export interface ResearchResultMetadata {
  readonly promptId: string;
  readonly promptVersion: string;
  readonly provider: string;
  readonly model: string;
  readonly tokenUsage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
  };
  readonly latencyMs: number;
  /** Live web searches run for this briefing (0/absent when search is off). */
  readonly webSearchCount?: number;
}

/**
 * ResearchResult — the RICH, strongly-typed output of an AI research call.
 *
 * The provider parses the model's raw text into this structure. `warnings`
 * captures anything the parser couldn't do cleanly (e.g. no key points found),
 * and `metadata` carries token usage / latency for observability.
 */
export interface ResearchResult {
  readonly summary: string;
  readonly keyPoints: readonly string[];
  readonly references: readonly ResearchReference[];
  readonly warnings: readonly string[];
  readonly metadata: ResearchResultMetadata;
}
