/**
 * The pipeline layer — the canonical, shared data model for a workflow run.
 *
 * Import the shared object and helpers from here, e.g.:
 *   import { type PipelineData, createEmptyPipelineData, updatePipeline } from "../pipeline/index.js";
 *
 * Contains data shapes + pure helpers only: no business logic, AI, providers,
 * storage, or database code.
 */

// The central object + the final deliverable.
export type { PipelineData } from "./pipeline-data.js";
export type { VideoPackage } from "./video-package.js";

// Builder + immutable update helpers.
export { createEmptyPipelineData, createPipelineData } from "./pipeline-builder.js";
export {
  updatePipeline,
  setSection,
  appendScene,
  appendVisualAsset,
} from "./pipeline-update.js";

// Validation contracts.
export type {
  PipelineValidator,
  ValidationResult,
  ValidationIssue,
  ValidationSeverity,
} from "./validators.js";

// Every focused model.
export type * from "./models/index.js";
