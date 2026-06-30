import type { Video } from "./models/video.js";
import type { Thumbnail } from "./models/thumbnail.js";
import type { Captions } from "./models/caption.js";
import type { SeoMetadata } from "./models/seo.js";
import type { Script } from "./models/script.js";
import type { VisualAsset } from "./models/visual-asset.js";
import type { Voiceover } from "./models/voiceover.js";

/**
 * VideoPackage — the FINAL deliverable, assembled once the workflow completes.
 *
 * Where `PipelineData` is the work-in-progress folder (everything optional), a
 * `VideoPackage` is the finished bundle with the required pieces present. This
 * is what will eventually be handed off (e.g. delivered to Telegram) for the
 * user to upload manually.
 *
 * NOTE: this is the rich, canonical deliverable. The small `VideoPackage` in
 * `src/types/index.ts` is the original Step-1 placeholder used by the skeleton
 * task and is unrelated.
 */
export interface VideoPackage {
  /** The rendered final video. */
  readonly video: Video;
  /** The cover image. */
  readonly thumbnail: Thumbnail;
  /** On-screen subtitles. */
  readonly captions: Captions;
  /** Upload title/description/tags. */
  readonly metadata: SeoMetadata;
  /** The narration script. */
  readonly script: Script;
  /** Every generated visual asset used to build the video. */
  readonly assets: readonly VisualAsset[];
  /** The voiceover track, if produced. */
  readonly voiceover?: Voiceover;
}
