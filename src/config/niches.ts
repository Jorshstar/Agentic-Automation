import type { Niche, NicheConfig } from "../types/index.js";

/**
 * The niches in ROTATION ORDER.
 *
 * The daily task moves to the next entry every few days (see
 * `src/lib/niche-rotation.ts`). To change the schedule, just reorder this array.
 *
 * `as const satisfies ...` gives us two things at once:
 *   - `as const`  → TypeScript treats the ids as exact literals, not plain strings
 *   - `satisfies` → TypeScript still checks every entry matches NicheConfig
 */
export const NICHE_ROTATION = [
  {
    id: "scary-stories",
    label: "Scary Stories",
    description: "Short, original horror micro-stories.",
  },
  {
    id: "tech-news",
    label: "Tech News",
    description: "A punchy recap of one notable tech story.",
  },
  {
    id: "relationship-advice",
    label: "Relationship Advice",
    description: "One practical, actionable relationship tip.",
  },
  {
    id: "user-storytelling",
    label: "User Storytelling",
    description: "A 60-second story built from a user-submitted idea.",
  },
] as const satisfies readonly NicheConfig[];

/** Look up the full config for a niche. Throws if the id is unknown. */
export function getNicheConfig(niche: Niche): NicheConfig {
  const found = NICHE_ROTATION.find((entry) => entry.id === niche);
  if (!found) {
    throw new Error(`Unknown niche: ${niche}`);
  }
  return found;
}
