/** Re-exports the visual-direction provider contract, real provider, and types. */
export type { VisualDirectionProvider } from "./visual-direction-provider.js";
export { ClaudeVisualDirectionProvider } from "./claude-visual-direction-provider.js";
export type {
  VisualAssetType,
  VisualDirectionSegment,
  VisualDirectionMetadata,
  VisualDirectionContext,
  VisualDirectionRequest,
  VisualDirectionPlan,
} from "./types.js";
export { VISUAL_ASSET_TYPES } from "./types.js";
