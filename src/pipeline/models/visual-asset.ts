/**
 * VisualAsset — one generated image/clip used to build the video.
 * The pipeline stores an ordered array of these.
 */
export type VisualAssetType = "image" | "clip" | "background";

export interface VisualAsset {
  readonly id: string;
  /** Which scene this asset belongs to. */
  readonly sceneIndex: number;
  readonly type: VisualAssetType;
  /** Where the asset lives (local path or remote URL). */
  readonly location: string;
  /** The prompt/description used to create it, if any. */
  readonly prompt?: string;
}
