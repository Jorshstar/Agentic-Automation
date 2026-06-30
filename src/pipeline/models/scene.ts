/**
 * Scene — one segment of the video: a slice of narration paired with a visual.
 * The pipeline stores an ordered array of these.
 */
export interface Scene {
  /** Order of the scene in the video (0-based). */
  readonly index: number;
  /** The narration spoken during this scene. */
  readonly scriptText: string;
  /** A description of the visual to show (used to generate it later). */
  readonly visualPrompt: string;
  /** When the scene starts, in seconds from the video start. */
  readonly startSeconds?: number;
  /** How long the scene lasts, in seconds. */
  readonly durationSeconds?: number;
}
