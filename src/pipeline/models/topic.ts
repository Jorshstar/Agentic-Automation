/**
 * Topic — the specific subject the video will cover.
 * Chosen early, then everything else (research, script...) builds on it.
 */
export interface Topic {
  /** Working title / subject line. */
  readonly title: string;
  /** The specific angle or hook that makes this topic interesting. */
  readonly angle: string;
  /** Optional longer description of what the video should say. */
  readonly description?: string;
  /** Keywords that guide research and SEO. */
  readonly keywords: readonly string[];
}
