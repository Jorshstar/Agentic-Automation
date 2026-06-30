/**
 * QaReport — the quality-assurance verdict on the finished video.
 */
export type QaSeverity = "info" | "warning" | "error";

export interface QaFinding {
  readonly severity: QaSeverity;
  readonly message: string;
}

export interface QaReport {
  /** Whether the video passed quality checks. */
  readonly approved: boolean;
  /** Quality score from 0 (bad) to 100 (great). */
  readonly score: number;
  /** Anything notable found during review; empty when perfect. */
  readonly findings: readonly QaFinding[];
}
