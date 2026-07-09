/**
 * The FORMAT REGISTRY (Phase 3) — which kind of production a brief asks for.
 *
 * A format decides HOW the pipeline's middle stages behave (script shape, voice
 * casting, visual strategy) while everything around them stays shared: topic,
 * research, ledger/checkpoints, composition, QA, SEO, thumbnails, delivery.
 *
 *   narrated-short — one narrator, scene-matched images (the original format)
 *   podcast        — two AI hosts in conversation, speaker-reactive visuals
 *
 * Coming next: "long-form" (chaptered documentaries stitched from chapter runs).
 */

export type VideoFormat = "narrated-short" | "podcast";

export const VIDEO_FORMATS: readonly VideoFormat[] = ["narrated-short", "podcast"];

export function isVideoFormat(value: unknown): value is VideoFormat {
  return typeof value === "string" && (VIDEO_FORMATS as readonly string[]).includes(value);
}
