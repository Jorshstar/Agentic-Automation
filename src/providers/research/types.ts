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

/** Historical eras the scary/history research rotates across. */
export type HistoricalEra =
  | "ancient" | "medieval" | "colonial" | "industrial"
  | "world-wars" | "cold-war" | "modern" | "recent";

export const HISTORICAL_ERAS: readonly HistoricalEra[] = [
  "ancient", "medieval", "colonial", "industrial",
  "world-wars", "cold-war", "modern", "recent",
];

/** How a claim is evidenced — the distinction the researcher must preserve. */
export type ClaimType =
  | "documented-fact" | "eyewitness-testimony" | "expert-theory"
  | "speculation" | "myth" | "folklore";

export const CLAIM_TYPES: readonly ClaimType[] = [
  "documented-fact", "eyewitness-testimony", "expert-theory",
  "speculation", "myth", "folklore",
];

export type ClaimConfidence = "high" | "medium" | "low";

export interface ResearchClaim {
  readonly claim: string;
  readonly type: ClaimType;
  readonly confidence: ClaimConfidence;
}

export interface ResearchTimelineEntry {
  readonly when: string;
  readonly what: string;
}

export interface ResearchTheory {
  readonly theory: string;
  readonly proponents: string;
  readonly evidence: string;
}

/**
 * The full historical research PACKAGE (scary/history niche).
 *
 * Produced instead of a loose briefing so downstream stages get structure:
 * the narrator gets `shockingFact` for the hook, the studio gets `country`/`era`
 * for hard rotation, and every assertion is tagged with how it is evidenced.
 */
export interface ResearchPackage {
  readonly eventName: string;
  readonly period: string;
  readonly country: string;
  readonly era: HistoricalEra;
  readonly location: string;
  readonly peopleInvolved: readonly string[];
  readonly background: string;
  readonly timeline: readonly ResearchTimelineEntry[];
  readonly officialExplanation: string;
  readonly alternativeTheories: readonly ResearchTheory[];
  readonly whyDebated: string;
  readonly unexplainedFacts: readonly string[];
  readonly claims: readonly ResearchClaim[];
  /** The single most disturbing TRUE fact — the narrator's hook material. */
  readonly shockingFact: string;
}

/** What the agent asks the provider to research. */
export interface ResearchRequest {
  /** The topic/title to research. Empty when the researcher must pick one. */
  readonly topic: string;
  /** Optional angle or focus for the research. */
  readonly angle?: string;
  /** Optional seed keywords to steer the research. */
  readonly keywords?: readonly string[];
  /**
   * Use the historical-research persona: the model SELECTS a real event (unless
   * `topic` is given), returns a full {@link ResearchPackage}, and obeys the
   * rotation bans below.
   */
  readonly historical?: boolean;
  /** Past topic titles the researcher must not reuse. */
  readonly avoidTopics?: readonly string[];
  /** Countries used recently — forbidden this run (hard rotation). */
  readonly avoidCountries?: readonly string[];
  /** Eras used recently — forbidden this run (hard rotation). */
  readonly avoidEras?: readonly string[];
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
  /** Present only for historical research — the full structured package. */
  readonly package?: ResearchPackage;
}
