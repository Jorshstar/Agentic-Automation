/**
 * Script — the narration for the 60-second video.
 */
export interface ScriptLine {
  /** Order of the line in the script (0-based). */
  readonly index: number;
  readonly text: string;
}

export interface Script {
  readonly title: string;
  /** The opening line that grabs attention. */
  readonly hook: string;
  /** The full narration text. */
  readonly body: string;
  /** The closing ask (e.g. "follow for more"). */
  readonly callToAction: string;
  /** Optional line-by-line breakdown (useful for captions/scenes). */
  readonly lines?: readonly ScriptLine[];
  readonly wordCount?: number;
  readonly estimatedDurationSeconds?: number;
}
