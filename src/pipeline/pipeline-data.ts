import type { WorkflowMetadata } from "./models/workflow-metadata.js";
import type { Topic } from "./models/topic.js";
import type { Research } from "./models/research.js";
import type { Script } from "./models/script.js";
import type { Scene } from "./models/scene.js";
import type { VisualAsset } from "./models/visual-asset.js";
import type { Voiceover } from "./models/voiceover.js";
import type { Captions } from "./models/caption.js";
import type { Video } from "./models/video.js";
import type { Thumbnail } from "./models/thumbnail.js";
import type { SeoMetadata } from "./models/seo.js";
import type { QaReport } from "./models/qa-report.js";
import type { StorageInfo } from "./models/storage.js";
import type { ExecutionMetadata } from "./models/execution-metadata.js";

/**
 * PipelineData — the ONE shared object that travels through the whole workflow.
 *
 * Think of it as a folder that starts almost empty and gains a new document at
 * each stage: research fills `research`, the script writer fills `script`, the
 * renderer fills `video`, and so on. Because every stage populates a DIFFERENT
 * part, every section is optional — a field is simply `undefined` until the
 * stage that produces it has run.
 *
 * Every future agent reads from and returns an updated copy of this object, so
 * there is a single source of truth and no ad-hoc objects passed around.
 */
export interface PipelineData {
  /** Header facts: niche, date, target platforms. */
  readonly workflow?: WorkflowMetadata;
  /** The chosen subject. */
  readonly topic?: Topic;
  /** Gathered source material. */
  readonly research?: Research;
  /** The narration script. */
  readonly script?: Script;
  /** Ordered scenes (narration slice + visual). */
  readonly scenes?: readonly Scene[];
  /** Generated images/clips. */
  readonly visualAssets?: readonly VisualAsset[];
  /** The spoken-audio track. */
  readonly voiceover?: Voiceover;
  /** On-screen subtitles. */
  readonly captions?: Captions;
  /** The rendered final video. */
  readonly video?: Video;
  /** The cover image. */
  readonly thumbnail?: Thumbnail;
  /** Upload title/description/tags. */
  readonly seo?: SeoMetadata;
  /** Quality-assurance verdict. */
  readonly qa?: QaReport;
  /** Where the package was saved. */
  readonly storage?: StorageInfo;
  /** Live run status (state, completed steps, timestamps). */
  readonly execution?: ExecutionMetadata;
}
