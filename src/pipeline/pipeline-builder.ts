import type { PipelineData } from "./pipeline-data.js";

/**
 * Pipeline builder — creates fresh PipelineData objects.
 *
 * No business logic, no AI: a brand-new pipeline is simply an empty object
 * (every section is optional and starts `undefined`). `createPipelineData` lets
 * you optionally seed known-up-front sections (like `workflow`/`execution`)
 * without mutating anything.
 */

/** A completely empty pipeline — the sensible default starting point. */
export function createEmptyPipelineData(): PipelineData {
  return {};
}

/** Create a pipeline pre-filled with whatever sections you already know. */
export function createPipelineData(seed: Partial<PipelineData> = {}): PipelineData {
  return { ...createEmptyPipelineData(), ...seed };
}
