/**
 * SEO types — the request/response shapes the upload-kit stage speaks.
 *
 * This stage turns a finished video's content into PLATFORM-READY upload
 * metadata: a YouTube title/description/tags/hashtags and a TikTok caption +
 * hashtags. It's pure text (one cheap AI Kernel call) and runs after QA, so
 * posting becomes copy-paste. It never touches the video itself.
 */

/** What the caller gives the SEO stage (all content, no media). */
export interface SeoRequest {
  readonly topic: string;
  readonly hook: string;
  /** The full spoken narration (gives the model the real content). */
  readonly script: string;
  /** Human niche label (e.g. "Scary Stories"). */
  readonly niche: string;
  readonly tone: string;
  readonly audience: string;
  readonly keywords: readonly string[];
  readonly durationSeconds: number;
  /** Target platform label (e.g. "YouTube Shorts"). Defaults when omitted. */
  readonly platform?: string;
  /**
   * How much description to write.
   *
   * "short" (the default) is the two-to-four sentence teaser a Short wants.
   * "longform" is a full upload description — several paragraphs covering what
   * this part actually contains, where it sits in the series, and its sources.
   * A documentary published with a two-line description is undersold, and that
   * is what the short prompt produced for one.
   */
  readonly format?: "short" | "longform";
}

/** YouTube upload metadata. */
export interface YouTubeSeo {
  /** ≤90 chars, curiosity-driven, faithful to the content. */
  readonly title: string;
  /** Hook-led, ends with a CTA, no hashtags inside. Length follows `format`. */
  readonly description: string;
  /** 10-15 plain lowercase search phrases for the tags box (no '#'). */
  readonly tags: readonly string[];
  /** 3-5 hashtags; #shorts is forced only for short-format video. */
  readonly hashtags: readonly string[];
}

/** TikTok upload metadata. */
export interface TikTokSeo {
  /** ≤130 chars, punchy. Hashtags are kept separate. */
  readonly caption: string;
  /** 4-6 hashtags incl. #fyp. */
  readonly hashtags: readonly string[];
}

/** A structured, machine-readable warning (never a bare string). */
export type SeoWarningCode = "parse-error" | "missing-field" | "generation-failed";

export interface SeoWarning {
  readonly code: SeoWarningCode;
  readonly message: string;
}

/** Tokens + timing + routing recorded for one SEO generation. */
export interface SeoMetadata {
  readonly promptId: string;
  readonly promptVersion: string;
  readonly provider: string;
  readonly model: string;
  readonly tokenUsage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
  };
  readonly latencyMs: number;
}

/**
 * SeoPack — the strongly-typed upload kit. Defensive: a generation failure
 * produces a usable fallback pack (built from the topic/hook/keywords) plus a
 * warning — a finished video is never blocked by SEO.
 */
export interface SeoPack {
  readonly youtube: YouTubeSeo;
  readonly tiktok: TikTokSeo;
  /** 2-4 ALL-CAPS words burned onto the cover image (≤20 chars). */
  readonly thumbnailText: string;
  readonly warnings: readonly SeoWarning[];
  readonly metadata: SeoMetadata;
}
