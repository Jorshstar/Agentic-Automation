/**
 * Research — the source material gathered for the topic.
 */
export interface ResearchSource {
  readonly title: string;
  /** Where the fact came from. */
  readonly url: string;
}

export interface Research {
  /** Short overview of what was found. */
  readonly summary: string;
  /** The most important facts to mention in the video. */
  readonly keyPoints: readonly string[];
  /** Where the information came from. */
  readonly sources: readonly ResearchSource[];
}
