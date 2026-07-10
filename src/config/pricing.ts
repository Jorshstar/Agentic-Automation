/**
 * Pricing — ESTIMATED per-unit costs so every run reports what it actually
 * spent, instead of the placeholder $0.
 *
 * These are editable estimates (vendors change prices); update the constants
 * when pricing changes. Estimates deliberately round UP a little — better to
 * over-report cost than under-report it.
 */

/** USD per 1M tokens for the Claude model the studio uses (claude-opus-4-8). */
export const CLAUDE_INPUT_PER_MTOK = 5.0;
export const CLAUDE_OUTPUT_PER_MTOK = 25.0;

/** USD per generated image (gpt-image-1, medium quality, 1024x1536). */
export const IMAGE_PRICE_USD = 0.07;

/** USD per minute of synthesized speech (gpt-4o-mini-tts, approximate). */
export const TTS_PRICE_PER_MINUTE_USD = 0.015;

/** USD per Anthropic server-side web search ($10 per 1,000 searches). */
export const WEB_SEARCH_PRICE_USD = 0.01;

/** Cost of live web searches run during a stage. */
export function webSearchCostUsd(searches: number): number {
  return round4(Math.max(0, searches) * WEB_SEARCH_PRICE_USD);
}

/** Token usage shape shared by all AI-stage metadata. */
export interface TokenUsageLike {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/** Cost of one Claude call from its token usage. */
export function claudeCostUsd(usage: TokenUsageLike): number {
  const input = (usage.inputTokens / 1_000_000) * CLAUDE_INPUT_PER_MTOK;
  const output = (usage.outputTokens / 1_000_000) * CLAUDE_OUTPUT_PER_MTOK;
  return round4(input + output);
}

/** Cost of generated images. */
export function imagesCostUsd(count: number): number {
  return round4(Math.max(0, count) * IMAGE_PRICE_USD);
}

/** Cost of synthesized narration from its real duration. */
export function ttsCostUsd(durationSeconds: number): number {
  return round4(Math.max(0, durationSeconds / 60) * TTS_PRICE_PER_MINUTE_USD);
}

export function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
