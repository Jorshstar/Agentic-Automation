import type { QaRequest, QaReport } from "./types.js";

/**
 * QualityAssuranceProvider — the CONTRACT for anything that validates a rendered
 * video ({@link QaReport}).
 *
 * Callers depend only on this interface. Today an ffprobe-based checker satisfies
 * it; a richer checker (black-frame / silence / loudness analysis) could later,
 * with no change to callers.
 */
export interface QualityAssuranceProvider {
  /** Stable name for logs (e.g. "ffprobe-qa-provider"). */
  readonly name: string;
  /** Probe the video and return a structured pass/fail report. */
  review(request: QaRequest): Promise<QaReport>;
}
