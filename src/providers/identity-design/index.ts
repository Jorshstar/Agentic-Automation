/** Re-exports the identity-design provider contract, real provider, and types. */
export type { IdentityDesignProvider } from "./identity-design-provider.js";
export { ClaudeIdentityDesignProvider } from "./claude-identity-design-provider.js";
export type {
  IdentityDesignRequest,
  IdentityDesignWarning,
  IdentityDesignWarningCode,
  IdentityDesignMetadata,
  DesignedIdentity,
} from "./types.js";
