/**
 * Captions — on-screen subtitles, as timed cues.
 */
export type CaptionFormat = "srt" | "vtt";

export interface CaptionCue {
  readonly index: number;
  /** When the cue appears, in seconds. */
  readonly startSeconds: number;
  /** When the cue disappears, in seconds. */
  readonly endSeconds: number;
  readonly text: string;
}

export interface Captions {
  readonly cues: readonly CaptionCue[];
  /** Where the subtitle file lives, if one was written. */
  readonly fileLocation?: string;
  readonly format?: CaptionFormat;
}
