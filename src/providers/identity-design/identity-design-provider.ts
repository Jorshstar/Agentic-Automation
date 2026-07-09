import type { IdentityDesignRequest, DesignedIdentity } from "./types.js";

/**
 * IdentityDesignProvider — the CONTRACT for anything that designs a one-off
 * creative identity ({@link DesignedIdentity}) from a plain-words brief.
 */
export interface IdentityDesignProvider {
  readonly name: string;
  /** Design the identity. Never throws — degrades to a neutral fallback. */
  design(request: IdentityDesignRequest): Promise<DesignedIdentity>;
}
