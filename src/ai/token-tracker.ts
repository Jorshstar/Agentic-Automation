/**
 * TokenTracker — records token usage per generation (PLACEHOLDER).
 *
 * Only the contract exists; no real token accounting yet.
 */
export interface TokenRecord {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface TokenTotals {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface TokenTracker {
  record(record: TokenRecord): void;
  totals(): TokenTotals;
}
