/** Re-exports the asset-generation provider contract, real provider, and types. */
export type { AssetGenerationProvider } from "./asset-generation-provider.js";
export { ClaudeAssetGenerationProvider } from "./claude-asset-generation-provider.js";
export type {
  AssetGenerationMethod,
  AssetGenerationStatus,
  AssetGenerationWarning,
  AssetGenerationWarningCode,
  AssetProviderResult,
  GeneratedAsset,
  GeneratedAssetMetadata,
  GeneratedAssets,
  GeneratedAssetContext,
  GeneratedAssetRequest,
  AssetGenerationRunMetadata,
} from "./types.js";
export { ASSET_GENERATION_METHODS, ASSET_GENERATION_STATUSES } from "./types.js";
