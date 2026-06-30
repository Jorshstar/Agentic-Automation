import type {
  ResearchRequest,
  ResearchProviderResult,
  TopicValidation,
  SummarizeRequest,
  SummarizeResult,
} from "./types.js";

/**
 * ResearchProvider — the CONTRACT for anything that can do research.
 *
 * The agent talks only to this interface, never to a specific AI service. Today
 * a mock implements it; tomorrow a real provider (OpenAI/Claude/Perplexity/...)
 * can implement the exact same methods, and the agent won't need to change.
 */
export interface ResearchProvider {
  /** Stable name for logs (e.g. "mock-research-provider"). */
  readonly name: string;
  /** Research a topic and return structured findings. */
  researchTopic(request: ResearchRequest): Promise<ResearchProviderResult>;
  /** Check a topic is usable before researching it. */
  validateTopic(topic: string): Promise<TopicValidation>;
  /** Condense a block of text into a short summary. */
  summarize(request: SummarizeRequest): Promise<SummarizeResult>;
}
