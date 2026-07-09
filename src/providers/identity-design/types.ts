import type { NicheProfile } from "../../config/niche-profiles.js";

/**
 * Identity design types — the "one-off show designer".
 *
 * Given a plain-words brief ("a calm bedtime-history channel for kids"), the
 * designer produces a complete creative identity — the same NicheProfile shape
 * that drives every pipeline stage — so a ContentBrief is never limited to the
 * preset niches. One cheap AI Kernel call; defensive parsing with a usable
 * fallback so a bad response can never block a run.
 */

export interface IdentityDesignRequest {
  /** What to make, in plain words (the ContentBrief instructions). */
  readonly instructions: string;
}

export type IdentityDesignWarningCode = "parse-error" | "missing-field" | "generation-failed";

export interface IdentityDesignWarning {
  readonly code: IdentityDesignWarningCode;
  readonly message: string;
}

export interface IdentityDesignMetadata {
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

/** The designed identity: a full profile with `niche: "custom"`. */
export interface DesignedIdentity {
  readonly profile: NicheProfile;
  readonly warnings: readonly IdentityDesignWarning[];
  readonly metadata: IdentityDesignMetadata;
}
