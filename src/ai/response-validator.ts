import type { ExpectedOutput } from "./types.js";

/**
 * ResponseValidator — turns a raw model response into a validated, typed value.
 *
 * Designed to support validating JSON, Markdown, plain text, and structured
 * objects (see {@link ExpectedOutput}). No validation logic is implemented here.
 */
export interface ResponseValidator {
  /** Validate/parse the raw text into the expected output type. */
  validate<TOutput>(raw: string, expected: ExpectedOutput): TOutput;
}
