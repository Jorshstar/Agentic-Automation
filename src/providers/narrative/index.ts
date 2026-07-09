/** Re-exports the narrative provider contract, real provider, and types. */
export type { NarrativeProvider } from "./narrative-provider.js";
export { ClaudeNarrativeProvider } from "./claude-narrative-provider.js";
export type {
  NarrativeScript,
  NarrativeSegment,
  NarrativeMetadata,
  NarrativeContext,
  NarrativeRequest,
} from "./types.js";
