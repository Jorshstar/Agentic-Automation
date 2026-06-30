/**
 * Shared domain types for the Agentic AI Content Studio.
 *
 * These describe the "shape" of the data that flows through the app. Most of
 * the work (scripts, voiceovers, rendered videos) is added in later steps, so
 * the optional fields below are intentionally empty for now — the foundation
 * still compiles before those steps exist.
 */

/** The four content niches this studio rotates through. */
export type Niche =
  | "scary-stories"
  | "tech-news"
  | "relationship-advice"
  | "user-storytelling";

/** Social platforms a finished video is uploaded to (manually, for now). */
export type Platform = "youtube" | "tiktok";

/** Where a finished video package can be delivered. Implemented in later steps. */
export type StorageTarget = "local" | "google-drive" | "cloud-storage";

/** Static description of a single niche. */
export interface NicheConfig {
  /** Stable machine id (matches the {@link Niche} union). */
  readonly id: Niche;
  /** Human-friendly name shown in logs and the README. */
  readonly label: string;
  /** One-line description of the content style. */
  readonly description: string;
}

/**
 * The full deliverable for one day: everything needed to manually upload one
 * faceless 60-second video to YouTube / TikTok.
 *
 * The `?` (optional) fields are produced by future steps:
 *   - title/script  → AI scripting step
 *   - videoUrl      → render step
 *   - storedAt      → storage step
 */
export interface VideoPackage {
  /** The calendar day this package is for, as `YYYY-MM-DD`. */
  readonly date: string;
  /** Which niche today's video belongs to. */
  readonly niche: Niche;
  /** Proposed video title. */
  readonly title?: string;
  /** Full narration script. */
  readonly script?: string;
  /** Path or URL to the rendered 60s vertical video. */
  readonly videoUrl?: string;
  /** Which storage targets the package was saved to. */
  readonly storedAt?: readonly StorageTarget[];
}
