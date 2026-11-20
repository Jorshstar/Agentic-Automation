import { describe, it, expect } from "vitest";
import { fillImageGaps } from "./run-part.js";
import type { GeneratedImage, GeneratedImages } from "../providers/image-generation/index.js";

const image = (segmentId: string, ok = true): GeneratedImage =>
  ({
    segmentId,
    prompt: "",
    imagePath: ok ? `${segmentId}.png` : "",
    status: ok ? "generated" : "failed",
    model: "gpt-image-2.6-flare",
    format: "png",
    width: 1536,
    height: 1024,
    bytes: ok ? 1000 : 0,
  }) as GeneratedImage;

const wrap = (images: GeneratedImage[]): GeneratedImages =>
  ({ images, outputDir: "", warnings: [], metadata: {} }) as unknown as GeneratedImages;

describe("fillImageGaps", () => {
  const ids = ["seg-1", "seg-2", "seg-3", "seg-4", "seg-5"];

  it("leaves a complete set untouched", () => {
    const result = fillImageGaps(wrap(ids.map((id) => image(id))), ids);
    expect(result.reused).toBe(0);
    expect(result.images.images).toHaveLength(5);
  });

  it("covers a gap so it never becomes a blank card", () => {
    // The measured failure: one image of nine failed and the video showed six
    // seconds of pure black.
    const present = ids.filter((id) => id !== "seg-3").map((id) => image(id));
    const result = fillImageGaps(wrap(present), ids);

    expect(result.reused).toBe(1);
    expect(result.images.images).toHaveLength(5);
    const filled = result.images.images.find((entry) => entry.segmentId === "seg-3")!;
    expect(filled.imagePath).not.toBe("");
    expect(filled.status).toBe("generated");
  });

  it("borrows from the NEAREST neighbour, so the picture stays relevant", () => {
    const present = [image("seg-1"), image("seg-2"), image("seg-5")];
    const result = fillImageGaps(wrap(present), ids);
    // seg-3's closest available neighbour is seg-2, not seg-5.
    const third = result.images.images.find((entry) => entry.segmentId === "seg-3")!;
    expect(third.imagePath).toBe("seg-2.png");
  });

  it("covers a gap at the very start by looking forward", () => {
    const present = [image("seg-2"), image("seg-3"), image("seg-4"), image("seg-5")];
    const result = fillImageGaps(wrap(present), ids);
    expect(result.images.images.find((entry) => entry.segmentId === "seg-1")!.imagePath).toBe("seg-2.png");
  });

  it("covers a gap at the very end by looking back", () => {
    const present = [image("seg-1"), image("seg-2"), image("seg-3"), image("seg-4")];
    const result = fillImageGaps(wrap(present), ids);
    expect(result.images.images.find((entry) => entry.segmentId === "seg-5")!.imagePath).toBe("seg-4.png");
  });

  it("ignores entries that failed, rather than reusing an empty path", () => {
    const present = [image("seg-1"), image("seg-2", false), image("seg-3")];
    const result = fillImageGaps(wrap(present), ids);
    for (const entry of result.images.images) {
      expect(entry.imagePath).not.toBe("");
    }
  });

  it("does nothing when there is nothing to borrow", () => {
    const result = fillImageGaps(wrap([]), ids);
    expect(result.reused).toBe(0);
  });
});
