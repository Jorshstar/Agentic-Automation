import type { SeoRequest, SeoPack } from "./types.js";

/**
 * SeoProvider — the CONTRACT for anything that turns a finished video's content
 * into platform-ready upload metadata ({@link SeoPack}).
 *
 * Callers depend only on this interface, never on a specific AI service.
 */
export interface SeoProvider {
  /** Stable name for logs (e.g. "claude-seo-provider"). */
  readonly name: string;
  /** Produce the YouTube + TikTok upload kit. Never throws — falls back. */
  generate(request: SeoRequest): Promise<SeoPack>;
}
