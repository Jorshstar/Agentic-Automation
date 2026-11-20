import type { LumaFrames } from "./overlay.js";

/**
 * WHERE THE SUBJECT IS — found by measuring motion, not by asking a model.
 *
 * This replaced a vision call that asked gpt-4o-mini for the subject's
 * horizontal position as a 0..1 fraction. It did not work, and the way it
 * failed is worth recording: it returned exactly 0.50 at 0.90 confidence for
 * EVERY frame of every video. On ordinary footage that looks correct, because
 * the subject usually is near the middle — so months of clips could have been
 * cropped by a constant without anyone noticing. It was only caught by padding
 * a frame so the speaker sat at a known 0.25 and 0.75: both still came back
 * 0.50. Vision models are weak at precise spatial coordinates, and a confident
 * wrong number is worse than an admitted "don't know".
 *
 * What works instead: in a talking-head shot the person MOVES and the room does
 * not. Summing per-pixel change across frames, column by column, gives a motion
 * profile whose centre of mass is the subject. Deterministic, free, and it
 * measures the actual picture.
 */

export interface SubjectEstimate {
  /** Horizontal centre of the subject, 0 = left edge, 1 = right edge. */
  readonly xCenter: number;
  /**
   * How concentrated the motion was, 0..1. Always at or above
   * MIN_CONCENTRATION — a weaker reading is reported as no subject at all
   * rather than as a number with a caveat.
   */
  readonly confidence: number;
  /** For logs. */
  readonly note: string;
}

/** Columns quieter than this share of the peak are treated as background. */
const NOISE_FLOOR = 0.35;
/**
 * Share of total motion that must fall within a quarter-frame of the centre of
 * mass for there to be a real subject.
 *
 * The value matters more than it looks. That window spans half the columns, so
 * UNIFORMLY spread motion — a crowd, a camera pan, heavy grain — scores almost
 * exactly 0.5 by definition. A threshold at or below 0.5 therefore accepts
 * everything, which is what the first version did. A single moving person
 * scores close to 1.0, so 0.7 separates them cleanly.
 */
const MIN_CONCENTRATION = 0.7;

/**
 * Estimate the subject's horizontal position from a clip's luma frames.
 * Returns undefined when there is nothing to lock onto, so the caller can fall
 * back rather than crop on a guess.
 */
export function estimateSubject(input: LumaFrames): SubjectEstimate | undefined {
  const { frames, width, height } = input;
  if (frames.length < 3 || width === 0 || height === 0) return undefined;

  // Total absolute change per column, summed over rows and consecutive frames.
  const motion = new Float64Array(width);
  for (let f = 1; f < frames.length; f++) {
    const current = frames[f]!;
    const previous = frames[f - 1]!;
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        motion[x]! += Math.abs(current[row + x]! - previous[row + x]!);
      }
    }
  }

  const peak = Math.max(...motion);
  if (peak <= 0) return undefined; // a still image: nothing moved at all

  // Subtract the noise floor so a uniformly noisy background does not drag the
  // centre of mass toward the middle of the frame.
  let total = 0;
  let weighted = 0;
  const floor = peak * NOISE_FLOOR;
  for (let x = 0; x < width; x++) {
    const value = motion[x]! - floor;
    if (value <= 0) continue;
    total += value;
    weighted += value * x;
  }
  if (total <= 0) return undefined;

  const centreColumn = weighted / total;
  const xCenter = Math.min(Math.max(centreColumn / width, 0), 1);

  // How concentrated is that motion? Spread out means no single subject.
  const halfWindow = width / 4;
  let inside = 0;
  for (let x = 0; x < width; x++) {
    const value = motion[x]! - floor;
    if (value > 0 && Math.abs(x - centreColumn) <= halfWindow) inside += value;
  }
  const concentration = inside / total;
  if (concentration < MIN_CONCENTRATION) {
    // Return NOTHING rather than a low-confidence position. Handing back a
    // number with a caveat invites a caller to use it anyway — the first
    // version did exactly that, and uniform motion (concentration ~0.5) sailed
    // past a 0.45 threshold and cropped to a meaningless centre.
    return undefined;
  }

  return {
    xCenter,
    confidence: Math.min(1, concentration),
    note: `motion centre ${xCenter.toFixed(2)} (concentration ${concentration.toFixed(2)})`,
  };
}

/**
 * Per-window estimates, so a subject that moves across the frame is tracked
 * rather than averaged into one static position.
 */
export function estimateSubjectOverTime(
  input: LumaFrames,
  windows: number,
): readonly { readonly at: number; readonly estimate: SubjectEstimate | undefined }[] {
  const { frames, width, height } = input;
  if (frames.length < 6 || windows < 2) {
    return [{ at: 0.5, estimate: estimateSubject(input) }];
  }

  const perWindow = Math.max(3, Math.floor(frames.length / windows));
  const results: { at: number; estimate: SubjectEstimate | undefined }[] = [];
  for (let start = 0; start + perWindow <= frames.length; start += perWindow) {
    const slice = frames.slice(start, start + perWindow);
    results.push({
      // Position of this window's midpoint along the clip, 0..1.
      at: (start + perWindow / 2) / frames.length,
      estimate: estimateSubject({ frames: slice, width, height }),
    });
  }
  return results.length > 0 ? results : [{ at: 0.5, estimate: estimateSubject(input) }];
}
