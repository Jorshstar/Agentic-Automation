import type { PipelineData } from "./pipeline-data.js";

/**
 * Pipeline validation CONTRACTS.
 *
 * Interfaces only — they describe how a future validator will report whether a
 * pipeline is complete/correct (e.g. "does the script exist before rendering?").
 * No checks are implemented here; this just fixes the shape so validators and
 * the code that runs them agree.
 */

/** How serious a single problem is. */
export type ValidationSeverity = "warning" | "error";

/** One problem found in the pipeline. */
export interface ValidationIssue {
  /** Which part of the pipeline the issue is about (e.g. "script.body"). */
  readonly field: string;
  readonly message: string;
  readonly severity: ValidationSeverity;
}

/** The outcome of running a validator. */
export interface ValidationResult {
  /** True when there are no `error`-severity issues. */
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
}

/** Something that can check a pipeline and report issues. */
export interface PipelineValidator {
  /** Stable name for logs (e.g. "script-present"). */
  readonly name: string;
  validate(data: PipelineData): ValidationResult;
}
