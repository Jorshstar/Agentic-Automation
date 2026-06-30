import type {
  ScriptGenerationRequest,
  GeneratedScript,
  ImproveHookRequest,
  ImproveHookResult,
  GenerateCtaRequest,
  GenerateCtaResult,
  ValidateLengthRequest,
  LengthValidation,
} from "./types.js";

/**
 * ScriptProvider — the CONTRACT for anything that can write a script.
 *
 * The ScriptAgent talks only to this interface, never to a specific AI service,
 * so the mock today and a real provider tomorrow are fully interchangeable.
 */
export interface ScriptProvider {
  readonly name: string;
  /** Turn research into a full 60-second script. */
  generateScript(request: ScriptGenerationRequest): Promise<GeneratedScript>;
  /** Rewrite a hook to be punchier. */
  improveHook(request: ImproveHookRequest): Promise<ImproveHookResult>;
  /** Produce a closing call-to-action. */
  generateCTA(request: GenerateCtaRequest): Promise<GenerateCtaResult>;
  /** Check the script length suits the target duration. */
  validateLength(request: ValidateLengthRequest): Promise<LengthValidation>;
}
