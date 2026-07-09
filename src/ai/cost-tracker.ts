import type { ProviderName } from "./types.js";

/**
 * CostTracker — records money spent per generation (PLACEHOLDER).
 *
 * Only the contract exists; no pricing tables or calculations yet.
 */
export interface CostRecord {
  readonly provider: ProviderName;
  readonly model: string;
  readonly costUsd: number;
}

export interface CostTracker {
  record(record: CostRecord): void;
  totalUsd(): number;
}
