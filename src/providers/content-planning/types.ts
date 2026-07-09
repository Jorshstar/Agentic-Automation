import type { ResearchResult } from "../research/index.js";

/**
 * Content planning types — the request/response shapes a content-planning
 * provider speaks. A ContentPlan is the BLUEPRINT that sits between raw research
 * and the script: it decides the hook, the beats (sections), pacing, CTA, and
 * visual direction, so every downstream agent (Script, Storyboard, Thumbnail,
 * SEO, QA) works from one shared, structured plan instead of raw research.
 */

/**
 * The fixed production context the provider needs but the request doesn't carry
 * (audience, tone, platform, language, target length). Supplied at construction
 * time and fed into the prompt's required variables.
 */
export interface ContentPlanContext {
  readonly audience: string;
  readonly tone: string;
  readonly language: string;
  readonly platform: string;
  readonly targetDurationSeconds: number;
}

/** What the caller asks the content planner to turn into a plan. */
export interface ContentPlanRequest {
  /** The video topic/title. */
  readonly topic: string;
  /** The upstream research this plan must stay faithful to. */
  readonly research: ResearchResult;
  /** Optional per-call overrides of the provider's default context. */
  readonly context?: Partial<ContentPlanContext>;
}

/** One beat of the video: what it covers, why, for how long. */
export interface ContentPlanSection {
  readonly title: string;
  readonly purpose: string;
  readonly durationSeconds: number;
  readonly keyPoints: readonly string[];
}

/** Tokens + timing + routing recorded for one content-plan generation. */
export interface ContentPlanMetadata {
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

/**
 * ContentPlan — the strongly-typed blueprint for the video.
 *
 * `warnings` captures anything the parser had to fall back on (missing/invalid
 * fields), so a partial plan is never silently accepted. `metadata` carries
 * token usage / latency for observability.
 */
export interface ContentPlan {
  readonly hook: string;
  readonly coreMessage: string;
  readonly targetAudience: string;
  readonly tone: string;
  readonly estimatedDurationSeconds: number;
  readonly sections: readonly ContentPlanSection[];
  readonly callToAction: string;
  readonly visualStyle: string;
  readonly riskNotes: readonly string[];
  readonly warnings: readonly string[];
  readonly metadata: ContentPlanMetadata;
}
