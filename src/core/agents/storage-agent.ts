import type { BaseAgent } from "../base-agent.js";
import type { StorageTarget } from "../../types/index.js";

/** Saves the finished package to one or more storage targets. */
export interface StorageInput {
  readonly workflowId: string;
  readonly videoLocation: string;
  readonly metadataLocation: string;
  /** Which destinations to write to (local, Google Drive, cloud...). */
  readonly targets: readonly StorageTarget[];
}

export interface StorageOutput {
  /** Targets the package was successfully stored to. */
  readonly storedAt: readonly StorageTarget[];
}

export interface StorageAgent extends BaseAgent<StorageInput, StorageOutput> {
  readonly name: "storage-agent";
}
