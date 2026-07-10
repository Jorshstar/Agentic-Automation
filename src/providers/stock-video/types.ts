/**
 * Stock-video types — the request/response shapes the stock-footage stage speaks.
 *
 * This PRODUCTION stage fetches REAL filmed clips (native `fetch`, no SDK) from
 * free stock libraries and downloads a vertical clip per scene. It is a WATERFALL
 * source: the runner tries stock first and falls back to the AI image when no
 * good match exists — so narrative scenes keep their bespoke look while b-roll
 * scenes get real motion, for $0. Defensive: any miss is a structured "no clip"
 * (undefined), never a crash.
 */

/** Which free library a clip came from. */
export type StockSource = "pexels" | "pixabay";

/** Styling/selection settings for stock lookups. */
export interface StockVideoContext {
  /** Target frame size — clips are filtered to portrait and cropped to this. */
  readonly width: number;
  readonly height: number;
  /** Shortest acceptable clip (we loop shorter ones, but avoid 1-2s stingers). */
  readonly minDurationSeconds: number;
  /** Where downloaded clips are written. */
  readonly outputDir: string;
}

/** One scene's stock lookup. */
export interface StockVideoRequest {
  readonly segmentId: string;
  /** Search phrase (from the scene's visual hint / keywords). */
  readonly query: string;
  /** How long this scene runs — used to prefer clips at least this long. */
  readonly neededSeconds: number;
  readonly context?: Partial<StockVideoContext>;
}

export type StockVideoWarningCode = "no-key" | "search-failed" | "no-match" | "download-failed";

export interface StockVideoWarning {
  readonly code: StockVideoWarningCode;
  readonly message: string;
  readonly segmentId?: string;
}

/** A downloaded stock clip for a scene. */
export interface StockClip {
  readonly segmentId: string;
  readonly clipPath: string;
  readonly source: StockSource;
  readonly width: number;
  readonly height: number;
  readonly durationSeconds: number;
  /** The library's page URL (attribution — both licenses are permissive). */
  readonly creditUrl: string;
}

/** Result of one scene lookup: a clip, or undefined with warnings if none. */
export interface StockVideoResult {
  readonly clip?: StockClip;
  readonly warnings: readonly StockVideoWarning[];
}

/** A downloaded real photograph for a scene (Ken-Burns'd like an AI image). */
export interface StockPhoto {
  readonly segmentId: string;
  readonly photoPath: string;
  readonly source: StockSource;
  readonly width: number;
  readonly height: number;
  readonly creditUrl: string;
}

/** Result of one scene photo lookup. */
export interface StockPhotoResult {
  readonly photo?: StockPhoto;
  readonly warnings: readonly StockVideoWarning[];
}
