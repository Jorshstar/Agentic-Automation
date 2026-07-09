/**
 * Quality assurance types — the request/response shapes the QA stage speaks.
 *
 * QA is the safety net before publishing: it probes the rendered MP4 with ffprobe
 * and runs a checklist (both streams present, correct dimensions, duration close
 * to the narration, valid codecs, non-zero size). It returns a structured report
 * so a broken render is caught automatically instead of being uploaded. Read-only
 * — it inspects, it never edits.
 */

export type QaStatus = "pass" | "warn" | "fail";
export type QaSeverity = "error" | "warning" | "info";

/** One checklist item's result. */
export interface QaCheck {
  readonly id: string;
  readonly label: string;
  readonly status: QaStatus;
  readonly severity: QaSeverity;
  readonly detail: string;
}

/** What "good" looks like for this render. */
export interface QaContext {
  readonly expectedWidth: number;
  readonly expectedHeight: number;
  /** Narration total; when set, the render's duration is checked against it. */
  readonly expectedDurationSeconds?: number;
  /** Allowed duration drift as a fraction (e.g. 0.15 = ±15%). */
  readonly durationTolerance: number;
  /** Absolute platform floor in seconds (e.g. 60 — the Shorts rule). Blocking. */
  readonly minDurationSeconds?: number;
  /** Absolute platform ceiling in seconds (e.g. 72). Blocking. */
  readonly maxDurationSeconds?: number;
  readonly requireAudio: boolean;
  readonly minSizeBytes: number;
}

/** What the caller asks QA to review. */
export interface QaRequest {
  readonly videoPath: string;
  readonly context?: Partial<QaContext>;
}

/** The parsed facts ffprobe reported about the file. */
export interface QaProbe {
  readonly exists: boolean;
  readonly sizeBytes: number;
  readonly durationSeconds: number;
  readonly hasVideo: boolean;
  readonly hasAudio: boolean;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly videoCodec: string;
  readonly audioCodec: string;
}

export interface QaMetadata {
  readonly provider: string;
  readonly checkedAt: string;
  readonly latencyMs: number;
  readonly errorCount: number;
  readonly warningCount: number;
}

/**
 * QaReport — the strongly-typed verdict: overall pass/fail, every check, the raw
 * probe facts, and metadata. `passed` is true only when no check is a hard error.
 */
export interface QaReport {
  readonly videoPath: string;
  readonly passed: boolean;
  readonly status: QaStatus;
  readonly checks: readonly QaCheck[];
  readonly probe: QaProbe;
  readonly metadata: QaMetadata;
}
