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

/**
 * USD per generated image.
 *
 * OpenAI prices images by OUTPUT TOKEN ($30 per 1M, standard processing), not
 * per image, so this is the measured cost of ONE image at the studio's default
 * configuration — gpt-image-2.6-flare, quality "low", 1024x1536 — which came
 * back at 664 output tokens: 664 / 1e6 * 30 = $0.0199.
 *
 * The previous value, $0.07, was for gpt-image-1 at medium quality. That model
 * has since been retired, so the constant was costing a price for something
 * that could no longer be generated at all. Re-measure this when
 * OPENAI_IMAGE_MODEL or OPENAI_IMAGE_QUALITY changes: the quality tier alone
 * moves it roughly eightfold (5,488 tokens at the default tier vs 664 at "low").
 */
export const IMAGE_OUTPUT_TOKENS_PER_MTOK_USD = 30;
export const IMAGE_PRICE_USD = Number(process.env.IMAGE_PRICE_USD ?? 0.02);

/** Exact cost when the API reported the output-token count for an image. */
export function imageCostFromTokens(outputTokens: number): number {
  return round4((Math.max(0, outputTokens) / 1_000_000) * IMAGE_OUTPUT_TOKENS_PER_MTOK_USD);
}

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
