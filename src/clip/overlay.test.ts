import { describe, it, expect } from "vitest";
import { sanitizeRegions, delogoFilters, describeRegions, findStaticBands } from "./overlay.js";
import { wantsOverlaysGone } from "./run-clip-job.js";

const region = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  x: 0.08,
  y: 0.13,
  width: 0.84,
  height: 0.085,
  label: "title card",
  confidence: 0.9,
  ...over,
});

describe("sanitizeRegions", () => {
  it("keeps a plausible title card", () => {
    const result = sanitizeRegions([region()]);
    expect(result).toHaveLength(1);
    expect(result[0]!.label).toBe("title card");
  });

  it("rejects a box covering most of the frame — that is the video itself", () => {
    expect(sanitizeRegions([region({ x: 0, y: 0, width: 1, height: 1 })])).toHaveLength(0);
    expect(sanitizeRegions([region({ x: 0, y: 0, width: 0.9, height: 0.8 })])).toHaveLength(0);
  });

  it("rejects slivers and zero-size boxes", () => {
    expect(sanitizeRegions([region({ width: 0.001, height: 0.001 })])).toHaveLength(0);
    expect(sanitizeRegions([region({ width: 0 })])).toHaveLength(0);
    expect(sanitizeRegions([region({ height: -0.2 })])).toHaveLength(0);
  });

  it("rejects low confidence rather than erasing something real", () => {
    expect(sanitizeRegions([region({ confidence: 0.2 })])).toHaveLength(0);
  });

  it("clamps a box that overhangs the frame instead of discarding it", () => {
    const result = sanitizeRegions([region({ x: 0.8, y: 0.9, width: 0.5, height: 0.3 })]);
    expect(result).toHaveLength(1);
    expect(result[0]!.x + result[0]!.width).toBeLessThanOrEqual(1);
    expect(result[0]!.y + result[0]!.height).toBeLessThanOrEqual(1);
  });

  it("ignores malformed entries", () => {
    expect(sanitizeRegions([{ label: "x" }, { x: "a", y: 1 }, {}])).toHaveLength(0);
  });

  it("caps how many regions it will erase", () => {
    const many = Array.from({ length: 10 }, (_u, i) => region({ y: 0.05 * i }));
    expect(sanitizeRegions(many).length).toBeLessThanOrEqual(4);
  });
});

describe("delogoFilters", () => {
  const clean = sanitizeRegions([region()]);

  it("builds a delogo filter at pixel coordinates", () => {
    const filter = delogoFilters(clean, 576, 1024);
    expect(filter).toMatch(/^delogo=x=\d+:y=\d+:w=\d+:h=\d+$/u);
  });

  it("keeps the box inside the frame so delogo has pixels to sample", () => {
    // A box flush to the edge has nothing to interpolate from on that side.
    const edge = sanitizeRegions([region({ x: 0, y: 0, width: 0.3, height: 0.1 })]);
    const filter = delogoFilters(edge, 576, 1024);
    const x = Number(filter.match(/x=(\d+)/u)![1]);
    const y = Number(filter.match(/y=(\d+)/u)![1]);
    expect(x).toBeGreaterThanOrEqual(1);
    expect(y).toBeGreaterThanOrEqual(1);
  });

  it("never lets a box run past the frame", () => {
    const edge = sanitizeRegions([region({ x: 0.75, y: 0.88, width: 0.25, height: 0.12 })]);
    const filter = delogoFilters(edge, 576, 1024);
    const [x, y, w, h] = ["x", "y", "w", "h"].map((k) => Number(filter.match(new RegExp(`${k}=(\\d+)`, "u"))![1]));
    expect(x! + w!).toBeLessThan(576);
    expect(y! + h!).toBeLessThan(1024);
  });

  it("joins several regions into one chain", () => {
    const two = sanitizeRegions([region(), region({ y: 0.8, height: 0.06 })]);
    expect(delogoFilters(two, 576, 1024).split(",")).toHaveLength(2);
  });

  it("is empty when there is nothing to erase", () => {
    expect(delogoFilters([], 576, 1024)).toBe("");
  });
});

describe("wantsOverlaysGone", () => {
  it("recognises the ways someone actually asks", () => {
    for (const text of [
      "remove the caption",
      "can we remove the caption",
      "delete that title",
      "get rid of the watermark",
      "take off the text",
      "clip the funny bits without the caption",
      "erase the logo",
    ]) {
      expect(wantsOverlaysGone(text)).toBe(true);
    }
  });

  it("does not fire on an ordinary clip request", () => {
    for (const text of ["the goals", "funniest moments", "clip the key insights", "add captions"]) {
      expect(wantsOverlaysGone(text)).toBe(false);
    }
  });
});

describe("describeRegions", () => {
  it("says so plainly when nothing was found", () => {
    expect(describeRegions([])).toBe("none found");
  });

  it("names what it will erase", () => {
    expect(describeRegions(sanitizeRegions([region()]))).toContain("title card");
  });
});


describe("findStaticBands", () => {
  const W = 64;
  const H = 100;

  /**
   * Build frames with moving noise everywhere, then paint a fixed band that is
   * identical in every frame — exactly how a burned-in caption behaves.
   */
  const build = (band?: { from: number; to: number; detailed: boolean }): Uint8Array[] => {
    const frames: Uint8Array[] = [];
    for (let f = 0; f < 10; f++) {
      const frame = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          // Moving content: varies per frame.
          frame[y * W + x] = (x * 7 + y * 13 + f * 60) % 256;
        }
      }
      if (band) {
        for (let y = band.from; y < band.to; y++) {
          for (let x = 4; x < W - 4; x++) {
            // Static across frames; alternating = detailed, flat = not.
            frame[y * W + x] = band.detailed ? (x % 2 === 0 ? 240 : 10) : 128;
          }
        }
      }
      frames.push(frame);
    }
    return frames;
  };

  it("finds a static, detailed band — a burned-in caption", () => {
    const regions = findStaticBands({ frames: build({ from: 20, to: 32, detailed: true }), width: W, height: H });
    expect(regions).toHaveLength(1);
    const found = regions[0]!;
    expect(found.y).toBeLessThanOrEqual(20 / H);
    expect(found.y + found.height).toBeGreaterThanOrEqual(32 / H);
  });

  it("ignores a static band with no detail — a letterbox bar", () => {
    // Erasing a flat bar achieves nothing and risks eating real content.
    expect(findStaticBands({ frames: build({ from: 20, to: 32, detailed: false }), width: W, height: H })).toHaveLength(0);
  });

  it("finds nothing in footage where everything moves", () => {
    expect(findStaticBands({ frames: build(), width: W, height: H })).toHaveLength(0);
  });

  it("refuses to erase a band covering most of the frame", () => {
    // That is the video, not an overlay on top of it.
    expect(findStaticBands({ frames: build({ from: 5, to: 95, detailed: true }), width: W, height: H })).toHaveLength(0);
  });

  it("needs several frames before it can tell static from moving", () => {
    const frames = build({ from: 20, to: 32, detailed: true }).slice(0, 2);
    expect(findStaticBands({ frames, width: W, height: H })).toHaveLength(0);
  });

  it("returns nothing for empty input rather than throwing", () => {
    expect(findStaticBands({ frames: [], width: 0, height: 0 })).toEqual([]);
  });
});
