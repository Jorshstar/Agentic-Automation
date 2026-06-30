import type { BaseAgent } from "../base-agent.js";

/** Checks the finished video against quality rules before it ships. */
export interface QualityReviewInput {
  readonly videoLocation: string;
  readonly script: string;
}

export interface QualityReviewOutput {
  readonly approved: boolean;
  /** Quality score from 0 (bad) to 100 (great). */
  readonly score: number;
  /** Any problems found; empty when approved. */
  readonly issues: readonly string[];
}

export interface QualityReviewAgent extends BaseAgent<QualityReviewInput, QualityReviewOutput> {
  readonly name: "quality-review-agent";
}
