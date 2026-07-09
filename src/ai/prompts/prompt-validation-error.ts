import { BaseError } from "../../lib/errors.js";

/**
 * PromptValidationError — thrown when a prompt cannot be safely rendered.
 *
 * The most common cause is a MISSING required variable: a prompt declares
 * `requiredVariables` in its metadata, but the caller didn't supply one (or
 * supplied a blank value). Rather than render a prompt with a `{{hole}}` in it,
 * the PromptManager stops loudly. Not retryable — the same inputs will fail again.
 */
export class PromptValidationError extends BaseError {
  readonly code = "PROMPT_VALIDATION_ERROR";
  readonly retryable = false;

  /** The variable names that were required but missing/blank. */
  readonly missingVariables: readonly string[];

  constructor(promptId: string, missingVariables: readonly string[]) {
    super(
      `Prompt "${promptId}" is missing required variable(s): ${missingVariables.join(", ")}.`,
      { promptId, missingVariables: [...missingVariables] },
    );
    this.missingVariables = missingVariables;
  }
}
