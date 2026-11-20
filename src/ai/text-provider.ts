import type { ProviderName } from "./types.js";

/**
 * WHICH PROVIDER THE TEXT STAGES USE.
 *
 * Text work — writing a script, checking facts, choosing clip moments, running
 * the chat brain — can go to any OpenAI-compatible endpoint. Images and speech
 * cannot: a text-only server answers /images/generations and /audio/speech with
 * 404, which is exactly what the configured endpoint does.
 *
 * So this is deliberately only consulted by text stages. Image and voice
 * providers talk to OpenAI directly and are untouched by it.
 *
 * Set LLM_BASE_URL, LLM_API_KEY and LLM_MODEL to move text off OpenAI. With
 * none of them set, everything stays on OpenAI exactly as before.
 */

export function hasCustomTextEndpoint(): boolean {
  return Boolean(process.env.LLM_BASE_URL?.trim() && process.env.LLM_API_KEY?.trim());
}

/** "local" when a custom endpoint is configured, otherwise "openai". */
export function textProvider(): ProviderName {
  return hasCustomTextEndpoint() ? "local" : "openai";
}

/**
 * Per-request overrides for a text stage.
 *
 * `model` is left to the client when a custom endpoint is in use, because that
 * endpoint serves one model and a prompt's `preferredModel` names an OpenAI
 * one it has never heard of.
 */
export function textProviderOptions(
  modelEnvVar?: string,
  /**
   * Env var naming a provider for THIS stage specifically, e.g.
   * LONGFORM_SCRIPT_PROVIDER=openai.
   *
   * Stages are not interchangeable, and that is measured rather than assumed.
   * Running a documentary part on gpt-oss-120b had the fact checker flag EIGHT
   * of nine beats — invented internal memos, invented engagement figures, a
   * secret team called "Project Reels" that never existed — against one of nine
   * for the same prompt on gpt-4o. The same model CHECKED facts well, catching
   * every one of those. So writing wants the stronger model while verifying,
   * selecting and chatting are fine on a cheaper one, and a per-stage override
   * is how that is expressed.
   */
  providerEnvVar?: string,
): { provider: ProviderName; model?: string } {
  const forced = providerEnvVar ? process.env[providerEnvVar]?.trim().toLowerCase() : undefined;
  const model = modelEnvVar ? process.env[modelEnvVar]?.trim() : undefined;

  if (forced === "openai") return { provider: "openai", ...(model ? { model } : {}) };
  if (forced === "local") return { provider: "local" };

  // A stage that names a provider env var but has not set it is opting OUT of
  // the custom endpoint by default — that is how writing stays on the stronger
  // model while verifying, selecting and chatting move to the cheaper one.
  if (providerEnvVar) return { provider: "openai", ...(model ? { model } : {}) };

  if (hasCustomTextEndpoint()) return { provider: "local" };
  return { provider: "openai", ...(model ? { model } : {}) };
}
