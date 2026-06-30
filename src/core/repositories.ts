import type { WorkflowState } from "./workflow-state.js";
import type { AssetRecord, ExecutionRecord, WorkflowRecord } from "./records.js";

/**
 * Repository contracts — ABSTRACTIONS for reading/writing data.
 *
 * These are interfaces only: they promise "you can save and fetch these
 * records" without saying where (Postgres? a JSON file? memory?). Code depends
 * on the interface, so we can swap the real implementation later without
 * touching any agent. No database / ORM / SQL appears anywhere in this layer.
 */

/** Stores and retrieves whole workflows. */
export interface WorkflowRepository {
  create(record: WorkflowRecord): Promise<void>;
  findById(id: string): Promise<WorkflowRecord | null>;
  updateState(id: string, state: WorkflowState): Promise<void>;
}

/** Stores and retrieves individual execution attempts. */
export interface ExecutionRepository {
  record(execution: ExecutionRecord): Promise<void>;
  findByWorkflowId(workflowId: string): Promise<readonly ExecutionRecord[]>;
}

/** Stores and retrieves produced assets (scripts, audio, video...). */
export interface AssetRepository {
  save(asset: AssetRecord): Promise<void>;
  findByWorkflowId(workflowId: string): Promise<readonly AssetRecord[]>;
}
