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
export function textProviderOptions(modelEnvVar?: string): {
  provider: ProviderName;
  model?: string;
} {
  if (hasCustomTextEndpoint()) return { provider: "local" };
  const override = modelEnvVar ? process.env[modelEnvVar]?.trim() : undefined;
  return { provider: "openai", ...(override ? { model: override } : {}) };
}
