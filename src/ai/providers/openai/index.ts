/**
 * The OpenAI adapter — the ONLY export is the ProviderClient implementation.
 *
 * The mappers and every OpenAI-shaped type stay private to this folder, so
 * nothing outside the Provider SDK Layer depends on the vendor's wire format.
 */
export { OpenAIProviderClient } from "./openai-provider-client.js";
