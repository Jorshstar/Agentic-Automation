import type { StockVideoRequest, StockVideoResult } from "./types.js";

/**
 * StockVideoProvider — the CONTRACT for anything that finds + downloads a real
 * vertical stock clip for a scene. `find` NEVER throws: a miss or an API failure
 * returns `{ clip: undefined, warnings }` so the runner can fall back to the AI
 * image without any try/catch at the call site.
 */
export interface StockVideoProvider {
  readonly name: string;
  find(request: StockVideoRequest): Promise<StockVideoResult>;
}
