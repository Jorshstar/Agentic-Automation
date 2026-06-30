import type { PipelineData } from "./pipeline-data.js";
import type { Scene } from "./models/scene.js";
import type { VisualAsset } from "./models/visual-asset.js";

/**
 * Immutable update helpers.
 *
 * The golden rule: NEVER change a PipelineData object in place. Instead, return
 * a NEW object that copies the old one and overlays your change. Immutable
 * updates make the data predictable — an agent can hold a reference without
 * fear that someone else mutated it underneath them, and history is easy to
 * keep for debugging.
 *
 * Every helper here returns a fresh PipelineData; the input is never modified.
 */

/** Merge a partial patch over the pipeline, returning a new object. */
export function updatePipeline(
  data: PipelineData,
  patch: Partial<PipelineData>,
): PipelineData {
  return { ...data, ...patch };
}

/** Set a single section, returning a new object. */
export function setSection<K extends keyof PipelineData>(
  data: PipelineData,
  key: K,
  value: PipelineData[K],
): PipelineData {
  return { ...data, [key]: value };
}

/** Append one scene to the (possibly empty) scenes list, returning a new object. */
export function appendScene(data: PipelineData, scene: Scene): PipelineData {
  return { ...data, scenes: [...(data.scenes ?? []), scene] };
}

/** Append one visual asset to the (possibly empty) list, returning a new object. */
export function appendVisualAsset(
  data: PipelineData,
  asset: VisualAsset,
): PipelineData {
  return { ...data, visualAssets: [...(data.visualAssets ?? []), asset] };
}
