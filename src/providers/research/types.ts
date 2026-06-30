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
