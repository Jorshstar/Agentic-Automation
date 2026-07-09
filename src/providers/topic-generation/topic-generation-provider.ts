import type { TopicGenerationRequest, GeneratedTopic } from "./types.js";

/**
 * TopicGenerationProvider — the CONTRACT for anything that invents a topic idea
 * for a niche ({@link GeneratedTopic}).
 */
export interface TopicGenerationProvider {
  readonly name: string;
  generate(request: TopicGenerationRequest): Promise<GeneratedTopic>;
}
