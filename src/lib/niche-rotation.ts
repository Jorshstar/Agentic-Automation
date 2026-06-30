import type { Niche } from "../types/index.js";
import { NICHE_ROTATION } from "../config/niches.js";
import { NICHE_ROTATION_DAYS } from "../config/constants.js";

/**
 * Niche rotation engine.
 *
 * Rule: one niche stays active for {@link DAYS_PER_NICHE} days, then we move to
 * the next niche in {@link NICHE_ROTATION}, wrapping back to the first after the
 * last. This is a PURE, deterministic function of the date — same date always
 * gives the same niche — which makes it trivial to test and reason about.
 */

/**
 * How many days each niche stays active before rotating to the next.
 * Re-exported from the central constants module so there is one source of truth.
 */
export const DAYS_PER_NICHE = NICHE_ROTATION_DAYS;

/**
 * The fixed date the rotation counts from.
 *   days 0,1,2  → niche[0]
 *   days 3,4,5  → niche[1]
 *   ...and so on, wrapping around.
 * Keep this constant so the rotation stays stable across deploys.
 */
export const ROTATION_ANCHOR = "2026-01-01";

/** Convert a `YYYY-MM-DD` date to a whole-day number (days since Unix epoch, UTC). */
function toUtcDayNumber(isoDate: string): number {
  const ms = Date.parse(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(ms)) {
    throw new Error(`Invalid date passed to niche rotation: "${isoDate}" (expected YYYY-MM-DD)`);
  }
  const msPerDay = 86_400_000;
  return Math.floor(ms / msPerDay);
}

/**
 * Decide which niche a given calendar day (`YYYY-MM-DD`) belongs to.
 *
 * @example
 * getNicheForDate("2026-01-01") // → first niche  (day 0)
 * getNicheForDate("2026-01-04") // → second niche (day 3)
 */
export function getNicheForDate(isoDate: string): Niche {
  const dayNumber = toUtcDayNumber(isoDate) - toUtcDayNumber(ROTATION_ANCHOR);
  const blockIndex = Math.floor(dayNumber / DAYS_PER_NICHE);

  // Modulo that also handles dates BEFORE the anchor (negative numbers) by
  // always returning a value in the range [0, count).
  const count = NICHE_ROTATION.length;
  const index = ((blockIndex % count) + count) % count;

  const entry = NICHE_ROTATION[index];
  if (!entry) {
    // Unreachable in practice (index is always valid), but keeps the types honest.
    throw new Error(`Rotation produced an out-of-range index: ${index}`);
  }
  return entry.id;
}
