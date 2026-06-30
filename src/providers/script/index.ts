/** Re-exports the script provider contract, mock, and types. */
export type { ScriptProvider } from "./script-provider.js";
export { MockScriptProvider } from "./mock-script-provider.js";
export type {
  ScriptGenerationRequest,
  GeneratedScript,
  ImproveHookRequest,
  ImproveHookResult,
  GenerateCtaRequest,
  GenerateCtaResult,
  ValidateLengthRequest,
  LengthValidation,
} from "./types.js";
