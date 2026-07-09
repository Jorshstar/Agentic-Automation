/**
 * The Claude adapter — the ONLY export is the ProviderClient implementation.
 *
 * The mappers and the Anthropic SDK stay private to this folder, so nothing
 * outside the Provider SDK Layer can see Anthropic-specific types.
 */
export { ClaudeProviderClient } from "./claude-provider-client.js";
