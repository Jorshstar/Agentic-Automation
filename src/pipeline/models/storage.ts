import type { StorageTarget } from "../../types/index.js";

/**
 * StorageInfo — where the finished package was saved.
 */
export interface StoredLocation {
  /** Which backend (local / google-drive / cloud-storage). */
  readonly target: StorageTarget;
  /** The path or URL the package lives at on that backend. */
  readonly location: string;
}

export interface StorageInfo {
  /** One entry per place the package was successfully stored. */
  readonly storedAt: readonly StoredLocation[];
}
