import type { AIGenerateRequest } from "./types.js";

/**
 * ModelSelector — chooses the model + temperature for a request when the caller
 * didn't specify them. Only the contract is defined here.
 */
export interface ModelSelector {
  selectModel(request: AIGenerateRequest): string;
  selectTemperature(request: AIGenerateRequest): number;
}
