import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveMediaTool } from "../lib/binaries.js";
import { probeJson } from "../lib/media.js";

const execFileAsync = promisify(execFile);

/**
 * BURNED-IN OVERLAY REMOVAL — getting someone else's title card, caption or
 * watermark out of a clip.
 *
 * Be clear about what is and is not possible. A burned-in overlay is PIXELS:
 * whatever was behind it is not in the file and cannot be recovered. So there
 * is no "undo", only three ways to deal with it, and we use the honest one:
 *
 *   - ffmpeg's `delogo` interpolates the covered area from the pixels around
 *     it. Over a flat background — a black letterbox band, a wall, grass — the
 *     result is invisible. Over detailed background it is a soft smear.
 *   - Cropping the band off is cleaner but changes the frame size.
 *   - Generative inpainting looks best and invents pixels, which is exactly the
 *     thing this pipeline does not do.
 *
 * Finding the overlay is a VISION call that returns COORDINATES. The model never
 * touches the picture; ffmpeg does the pixel work. Cost is about $0.0002 per
 * clip on gpt-4o-mini at low detail.
 *
 * Never throws: with no key, no detection or any failure, it returns no regions
 * and the clip renders untouched.
 */

/** A rectangle to erase, in fractions of frame size (0..1). */
export interface OverlayRegion {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** What it is, for the log. */
  readonly label: string;
  readonly confidence: number;
}

export interface DetectOverlaysInput {
  readonly sourcePath: string;
  readonly startSecond: number;
  readonly endSecond: number;
  readonly workDir: string;
}

/** Frames sampled across the clip to measure what moves and what does not. */
const SAMPLES = 10;
/** Guards used when a caller supplies regions directly (see sanitizeRegions). */
const MIN_CONFIDENCE = 0.5;
const MAX_AREA_FRACTION = 0.35;
const MIN_AREA_FRACTION = 0.002;
/** Analysis width; height follows the source aspect. Detail survives this. */
const ANALYSIS_WIDTH = 192;
/** 0-255 luma range below which a pixel counts as unchanging across the clip. */
const STATIC_LUMA_RANGE = 10;
/**
 * Share of a row's WIDTH that one unbroken static run must cover.
 *
 * Deliberately not "most of the row is static": a title card typically spans
 * about 84% of the width, leaving moving footage either side, and the band above
 * it is often a dark blurred copy of the video rather than true black — so the
 * row as a whole is never close to fully static. Measuring the longest
 * CONTIGUOUS static run finds the card and gives its horizontal extent too.
 */
const STATIC_RUN_FRACTION = 0.5;
/**
 * Detail threshold that makes a static region worth erasing at all.
 *
 * Note what this is NOT used for: it does not define the region's bounds. A
 * caption card is a white box with text on it, and only the TEXT rows carry
 * detail — bounding the region by detail therefore cut the box's own padding
 * out of it, and delogo then filled the box by sampling its white border,
 * leaving a clean white rectangle where the caption had been. The region is the
 * whole contiguous STATIC area; detail only decides whether that area is an
 * overlay worth removing or just a flat letterbox band.
 */
const MIN_ROW_DETAIL = 18;
/** Ignore bands thinner than this share of frame height — noise, not a card. */
const MIN_BAND_FRACTION = 0.015;
/** A band taller than this is the video itself, not an overlay on top of it. */
const MAX_BAND_FRACTION = 0.3;
/**
 * Vertical gap, as a share of frame height, that still counts as one overlay.
 *
 * A two-line caption card is found as TWO bands, because the uniform strip
 * between the lines is static but carries no detail and so fails the detail
 * test. Erasing the two text lines and leaving the card's background between
 * them looks worse than leaving the card alone, so nearby bands are merged into
 * the whole card.
 */
const MERGE_GAP_FRACTION = 0.03;
/** Grown slightly so a card's rounded corners and padding are covered too. */
const BAND_PAD_FRACTION = 0.006;

/**
 * Find burned-in overlays by looking for what DOESN'T change.
 *
 * A title card, a username watermark or a subscribe banner is painted onto every
 * frame in the same place, while the footage behind it moves. So a row of pixels
 * that never changes across the clip, but does contain detail, is an overlay —
 * and that is measurable exactly, for free, with no model involved.
 *
 * This replaced a vision call that asked a model for bounding boxes. It was
 * tried on a real TikTok title card and was simply not good enough: one run
 * returned two regions at 90% confidence in the wrong place, the next returned
 * none at all. Spatial precision is a known weakness of vision models, and the
 * failure was silent — the clip rendered with a smear in the middle and the card
 * still sitting there.
 */
export async function detectOverlays(input: DetectOverlaysInput): Promise<readonly OverlayRegion[]> {
  try {
    const frames = await sampleLuma(input);
    if (frames.frames.length < 3) return [];
    return findStaticBands(frames);
  } catch {
    return [];
  }
}

export interface LumaFrames {
  readonly frames: readonly Uint8Array[];
  readonly width: number;
  readonly height: number;
}

/**
 * Decode N evenly spread frames to raw 8-bit greyscale in ONE ffmpeg pass.
 * Greyscale at 192px wide is plenty to tell a static caption bar from moving
 * footage, and keeps the whole clip's pixel data to a few megabytes.
 */
export async function sampleLuma(input: DetectOverlaysInput): Promise<LumaFrames> {
  const duration = Math.max(1, input.endSecond - input.startSecond);
  const fps = SAMPLES / duration;
  const ffmpeg = await resolveMediaTool("ffmpeg");

  const { stdout } = await execFileAsync(
    ffmpeg,
    [
      "-hide_banner", "-loglevel", "error",
      "-ss", String(input.startSecond),
      "-t", String(duration),
      "-i", input.sourcePath,
      "-an",
      "-vf", `fps=${fps.toFixed(4)},scale=${ANALYSIS_WIDTH}:-2,format=gray`,
      "-frames:v", String(SAMPLES),
      "-f", "rawvideo", "-pix_fmt", "gray",
      "pipe:1",
    ],
    { maxBuffer: 1024 * 1024 * 64, timeout: 5 * 60_000, encoding: "buffer" },
  );

  const buffer = stdout as unknown as Buffer;
  // Height is not known until ffmpeg has scaled, so derive it from the data.
  const dimensions = await probeScaledSize(input.sourcePath);
  const frameSize = dimensions.width * dimensions.height;
  if (frameSize === 0 || buffer.length < frameSize) return { frames: [], width: 0, height: 0 };

  const frames: Uint8Array[] = [];
  for (let offset = 0; offset + frameSize <= buffer.length; offset += frameSize) {
    frames.push(new Uint8Array(buffer.subarray(offset, offset + frameSize)));
  }
  return { frames, width: dimensions.width, height: dimensions.height };
}

async function probeScaledSize(path: string): Promise<{ width: number; height: number }> {
  const json = (await probeJson(path)) as
    | { streams?: { codec_type?: string; width?: number; height?: number }[] }
    | undefined;
  const video = json?.streams?.find((stream) => stream.codec_type === "video");
  if (!video?.width || !video?.height) return { width: 0, height: 0 };
  // scale=192:-2 keeps the aspect and rounds the height to an even number.
  const height = Math.round((ANALYSIS_WIDTH * video.height) / video.width / 2) * 2;
  return { width: ANALYSIS_WIDTH, height };
}

/**
 * Rows that never change AND carry detail, grouped into bands.
 */
export function findStaticBands(input: LumaFrames): OverlayRegion[] {
  const { frames, width, height } = input;
  if (frames.length < 3 || width === 0 || height === 0) return [];

  interface RowHit {
    readonly from: number;
    readonly to: number;
    /** Whether this row carries enough detail to justify erasing the band. */
    readonly detailed: boolean;
  }
  const rows: (RowHit | undefined)[] = [];

  for (let y = 0; y < height; y++) {
    // Longest unbroken run of pixels that never change across the clip.
    let bestFrom = 0;
    let bestLength = 0;
    let runFrom = 0;
    let runLength = 0;

    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      let min = 255;
      let max = 0;
      for (const frame of frames) {
        const value = frame[index]!;
        if (value < min) min = value;
        if (value > max) max = value;
      }
      if (max - min <= STATIC_LUMA_RANGE) {
        if (runLength === 0) runFrom = x;
        runLength++;
        if (runLength > bestLength) {
          bestLength = runLength;
          bestFrom = runFrom;
        }
      } else {
        runLength = 0;
      }
    }

    if (bestLength / width < STATIC_RUN_FRACTION) {
      rows.push(undefined);
      continue;
    }

    let sum = 0;
    let sumSquares = 0;
    for (let x = bestFrom; x < bestFrom + bestLength; x++) {
      const value = frames[0]![y * width + x]!;
      sum += value;
      sumSquares += value * value;
    }
    const mean = sum / bestLength;
    const detail = Math.sqrt(Math.max(0, sumSquares / bestLength - mean * mean));

    rows.push({ from: bestFrom, to: bestFrom + bestLength, detailed: detail >= MIN_ROW_DETAIL });
  }

  // Group adjacent overlay rows into bands, tolerating a short gap so the line
  // spacing inside a two-line caption does not split it into two regions.
  const regions: OverlayRegion[] = [];
  const mergeGapRows = Math.max(3, Math.round(height * MERGE_GAP_FRACTION));
  const padRows = Math.max(1, Math.round(height * BAND_PAD_FRACTION));
  let bandStart: number | undefined;
  let bandFrom = width;
  let bandTo = 0;
  let bandHasDetail = false;
  let gap = 0;

  const close = (endRow: number): void => {
    if (bandStart === undefined) return;
    const top = Math.max(0, bandStart - padRows);
    const bottom = Math.min(height, endRow + padRows);
    const bandHeight = (bottom - top) / height;
    // A static band with no detail anywhere in it is a letterbox bar, not an
    // overlay. Erasing it would change nothing and risks eating real content.
    if (bandHasDetail && bandHeight >= MIN_BAND_FRACTION && bandHeight <= MAX_BAND_FRACTION) {
      regions.push({
        x: bandFrom / width,
        y: top / height,
        width: (bandTo - bandFrom) / width,
        height: bandHeight,
        label: `static ${Math.round((top / height) * 100)}%-${Math.round((bottom / height) * 100)}% of frame`,
        confidence: 0.95,
      });
    }
    bandStart = undefined;
    bandFrom = width;
    bandTo = 0;
    bandHasDetail = false;
  };

  for (let y = 0; y < height; y++) {
    const hit = rows[y];
    if (hit) {
      if (bandStart === undefined) bandStart = y;
      // Union of the runs, so a wide line and a narrow one are both covered.
      bandFrom = Math.min(bandFrom, hit.from);
      bandTo = Math.max(bandTo, hit.to);
      if (hit.detailed) bandHasDetail = true;
      gap = 0;
    } else if (bandStart !== undefined) {
      gap++;
      if (gap > mergeGapRows) close(y - gap);
    }
  }
  close(height);

  return regions.slice(0, 4);
}

/**
 * Validate regions supplied from OUTSIDE the detector — a manual override or a
 * stored preset. The detector bounds its own output, but anything hand-written
 * still has to be stopped from erasing the picture.
 */
export function sanitizeRegions(raw: readonly Record<string, unknown>[]): OverlayRegion[] {
  const regions: OverlayRegion[] = [];
  for (const item of raw) {
    const x = num(item["x"]);
    const y = num(item["y"]);
    const width = num(item["width"]);
    const height = num(item["height"]);
    const confidence = num(item["confidence"]) ?? 0.5;
    if (x === undefined || y === undefined || width === undefined || height === undefined) continue;
    if (width <= 0 || height <= 0) continue;
    if (confidence < MIN_CONFIDENCE) continue;

    // Clamp into the frame rather than discarding a box that merely overhangs.
    const left = Math.min(Math.max(x, 0), 1);
    const top = Math.min(Math.max(y, 0), 1);
    const right = Math.min(left + width, 1);
    const bottom = Math.min(top + height, 1);
    const area = (right - left) * (bottom - top);
    if (area < MIN_AREA_FRACTION || area > MAX_AREA_FRACTION) continue;

    regions.push({
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
      label: typeof item["label"] === "string" ? item["label"].slice(0, 60) : "overlay",
      confidence,
    });
  }
  return regions.slice(0, 4);
}

/**
 * Build the `delogo` filter chain for these regions at a given frame size.
 *
 * delogo fills a box by interpolating from the pixels immediately AROUND it, so
 * a box flush against an edge has nothing to sample on that side and renders
 * badly. Each box is therefore pulled at least one pixel inside the frame, and
 * grown slightly so anti-aliased text edges are covered rather than left as a
 * faint outline.
 */
export function delogoFilters(
  regions: readonly OverlayRegion[],
  frameWidth: number,
  frameHeight: number,
): string {
  const PAD = 2;
  const parts: string[] = [];
  for (const region of regions) {
    let x = Math.round(region.x * frameWidth) - PAD;
    let y = Math.round(region.y * frameHeight) - PAD;
    let w = Math.round(region.width * frameWidth) + PAD * 2;
    let h = Math.round(region.height * frameHeight) + PAD * 2;

    x = Math.min(Math.max(x, 1), frameWidth - 3);
    y = Math.min(Math.max(y, 1), frameHeight - 3);
    w = Math.min(w, frameWidth - x - 1);
    h = Math.min(h, frameHeight - y - 1);
    if (w < 2 || h < 2) continue;

    parts.push(`delogo=x=${x}:y=${y}:w=${w}:h=${h}`);
  }
  return parts.join(",");
}

/** Human-readable summary for the log. */
export function describeRegions(regions: readonly OverlayRegion[]): string {
  if (regions.length === 0) return "none found";
  return regions.map((r) => `${r.label} (${Math.round(r.confidence * 100)}%)`).join(", ");
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
