import type { OutputFormat, ProviderName } from "../types.js";
import type { PromptStatus } from "./prompt-version.js";

/**
 * PromptMetadata — everything ABOUT a prompt (not the prompt text itself).
 *
 * This is what turns a bare string into a managed asset: who owns it, when it
 * changed, which version is active, how it should be routed (provider/model/
 * temperature), and what output it produces. Reuses the AI Kernel's OutputFormat
 * and ProviderName so prompt config lines up with how the kernel runs it.
 */
export interface PromptMetadata {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly owner: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** The ACTIVE version id (e.g. "v2"). */
  readonly version: string;
  readonly status: PromptStatus;
  readonly tags: readonly string[];
  readonly outputFormat: OutputFormat;
  readonly preferredProvider?: ProviderName;
  readonly preferredModel?: string;
  readonly temperature?: number;
  /**
   * Variables the prompt REQUIRES before it can be rendered. The PromptManager
   * checks these are all supplied and non-empty and throws a
   * {@link PromptValidationError} if any are missing — so a prompt can never be
   * rendered with a hole in it. Omit (or leave empty) for prompts with no
   * mandatory variables.
   */
  readonly requiredVariables?: readonly string[];
}
