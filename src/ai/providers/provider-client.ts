import type { ProviderName } from "../types.js";
import type { ProviderRequest } from "./provider-request.js";
import type { ProviderResponse } from "./provider-response.js";

/**
 * ProviderClient — the CONTRACT every provider (Claude, OpenAI, Gemini, ...) must
 * implement. It takes a normalized {@link ProviderRequest} and returns a
 * standardized {@link ProviderResponse}. Adding a new provider = writing one
 * class that implements this interface. No `any`.
 */
export interface ProviderClient {
  readonly provider: ProviderName;
  generate(request: ProviderRequest): Promise<ProviderResponse>;
}
