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
} from "./types.js";
