import { describe, it, expect } from "vitest";
import { estimateSubject, estimateSubjectOverTime } from "./subject.js";

const W = 80;
const H = 40;

/**
 * Build frames with a static background and one moving blob at a known
 * horizontal position — the measurable version of "a person talking".
 */
const movingBlob = (xFraction: number, frameCount = 8): Uint8Array[] => {
  const centre = Math.round(xFraction * W);
  return Array.from({ length: frameCount }, (_unused, f) => {
    const frame = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        // Static background: identical in every frame.
        frame[y * W + x] = 60;
      }
    }
    // The blob changes brightness each frame — that is the motion.
    for (let y = 10; y < 30; y++) {
      for (let x = centre - 5; x <= centre + 5; x++) {
        if (x < 0 || x >= W) continue;
        frame[y * W + x] = f % 2 === 0 ? 20 : 220;
      }
    }
    return frame;
  });
};

describe("estimateSubject", () => {
  /**
   * The detector this replaced returned exactly 0.50 at 0.90 confidence no
   * matter where the subject was. These pin that it actually measures.
   */
  it("finds a subject on the left", () => {
    const result = estimateSubject({ frames: movingBlob(0.25), width: W, height: H })!;
    expect(result.xCenter).toBeGreaterThan(0.15);
    expect(result.xCenter).toBeLessThan(0.35);
  });

  it("finds a subject on the right", () => {
    const result = estimateSubject({ frames: movingBlob(0.75), width: W, height: H })!;
    expect(result.xCenter).toBeGreaterThan(0.65);
    expect(result.xCenter).toBeLessThan(0.85);
  });

  it("finds a centred subject too", () => {
    const result = estimateSubject({ frames: movingBlob(0.5), width: W, height: H })!;
    expect(result.xCenter).toBeGreaterThan(0.4);
    expect(result.xCenter).toBeLessThan(0.6);
  });

  it("is not a constant — different inputs give different answers", () => {
    const left = estimateSubject({ frames: movingBlob(0.2), width: W, height: H })!.xCenter;
    const right = estimateSubject({ frames: movingBlob(0.8), width: W, height: H })!.xCenter;
    expect(right - left).toBeGreaterThan(0.4);
  });

  it("returns nothing for a still image", () => {
    const still = Array.from({ length: 6 }, () => new Uint8Array(W * H).fill(100));
    expect(estimateSubject({ frames: still, width: W, height: H })).toBeUndefined();
  });

  it("finds NO subject when motion is everywhere", () => {
    // A crowd, a camera pan, heavy grain: nothing to crop to. Uniform motion
    // scores ~0.5 concentration by definition, so this is the case a threshold
    // at or below 0.5 wrongly accepts.
    const frames = Array.from({ length: 8 }, (_u, f) => {
      const frame = new Uint8Array(W * H);
      for (let i = 0; i < frame.length; i++) frame[i] = (i * 31 + f * 90) % 256;
      return frame;
    });
    expect(estimateSubject({ frames, width: W, height: H })).toBeUndefined();
  });

  it("never returns a position it is not confident in", () => {
    // The contract: a weak reading is absence, not a number with a caveat.
    const frames = Array.from({ length: 8 }, (_u, f) => {
      const frame = new Uint8Array(W * H);
      for (let i = 0; i < frame.length; i++) frame[i] = (i + f * 40) % 256;
      return frame;
    });
    const result = estimateSubject({ frames, width: W, height: H });
    if (result) expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("needs several frames before it can measure motion", () => {
    expect(estimateSubject({ frames: movingBlob(0.3, 2), width: W, height: H })).toBeUndefined();
  });
});

describe("estimateSubjectOverTime", () => {
  it("returns one estimate per window", () => {
    const samples = estimateSubjectOverTime({ frames: movingBlob(0.3, 12), width: W, height: H }, 3);
    expect(samples.length).toBeGreaterThanOrEqual(2);
    for (const sample of samples) {
      expect(sample.at).toBeGreaterThanOrEqual(0);
      expect(sample.at).toBeLessThanOrEqual(1);
    }
  });

  it("falls back to a single estimate when there are too few frames", () => {
    expect(estimateSubjectOverTime({ frames: movingBlob(0.3, 4), width: W, height: H }, 4)).toHaveLength(1);
  });
});
