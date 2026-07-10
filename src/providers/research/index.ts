/** Re-exports the research provider contract, mock, real provider, and types. */
export type { ResearchProvider } from "./research-provider.js";
export { MockResearchProvider } from "./mock-research-provider.js";
export { ClaudeResearchProvider } from "./claude-research-provider.js";
export type {
  ResearchRequest,
  ResearchProviderResult,
  ResearchProviderSource,
  TopicValidation,
  SummarizeRequest,
  SummarizeResult,
  ResearchContext,
  ResearchReference,
  ResearchResultMetadata,
  ResearchResult,
  ResearchPackage,
  ResearchClaim,
  ResearchTheory,
  ResearchTimelineEntry,
  HistoricalEra,
  ClaimType,
  ClaimConfidence,
} from "./types.js";
export { HISTORICAL_ERAS, CLAIM_TYPES } from "./types.js";
