/** Re-exports the topic-generation provider contract, real provider, and types. */
export type { TopicGenerationProvider } from "./topic-generation-provider.js";
export { ClaudeTopicGenerationProvider } from "./claude-topic-generation-provider.js";
export type {
  TopicIdea,
  TopicGenerationRequest,
  TopicGenerationWarning,
  TopicGenerationWarningCode,
  TopicGenerationMetadata,
  GeneratedTopic,
} from "./types.js";
