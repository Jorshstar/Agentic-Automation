/**
 * Topic generation types — the auto-topic stage.
 *
 * Given a niche's identity, it asks the AI Kernel (Claude) for ONE fresh, concrete
 * topic idea so a run can start from just a niche (fully autonomous). An explicit
 * topic passed to the runner overrides this. Only calls AIKernel.generate().
 */

export interface TopicIdea {
  readonly title: string;
  readonly angle: string;
  readonly hook: string;
  readonly keywords: readonly string[];
}

export interface TopicGenerationRequest {
  /** Human niche label (e.g. "Scary Stories"). */
  readonly niche: string;
  readonly audience: string;
  readonly tone: string;
  readonly themes: readonly string[];
  /** Previously-used topic titles to avoid ("none" when there are none). */
  readonly avoidTopics: string;
  /** Plain-words assignment the topic MUST fulfil ("none" when absent). */
  readonly directive: string;
}

export type TopicGenerationWarningCode = "parse-error" | "missing-field";

export interface TopicGenerationWarning {
  readonly code: TopicGenerationWarningCode;
  readonly message: string;
}

export interface TopicGenerationMetadata {
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
}

export interface GeneratedTopic {
  readonly idea: TopicIdea;
  readonly warnings: readonly TopicGenerationWarning[];
  readonly metadata: TopicGenerationMetadata;
}
