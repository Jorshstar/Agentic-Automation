import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withRetry } from "../../lib/retry.js";
import type { StockVideoProvider } from "./stock-video-provider.js";
import type {
  StockVideoContext,
  StockVideoRequest,
  StockVideoResult,
  StockPhotoResult,
  StockClip,
  StockSource,
  StockVideoWarning,
} from "./types.js";

/**
 * PexelsPixabayStockVideoProvider — the free-footage waterfall.
 *
 * For one scene it queries Pexels first (better curation), then Pixabay, and
 * returns the best VERTICAL clip it can download. Both are free with an API key;
 * a missing key just skips that source. Everything is defensive — a failure at
 * any step yields a warning and (eventually) `clip: undefined`, so the runner
 * falls back to the AI image. Native `fetch`, retry-wrapped, no SDK.
 */

const DEFAULT_CONTEXT: StockVideoContext = {
  width: 1080,
  height: 1920,
  minDurationSeconds: 4,
  outputDir: "output/stock",
};

/** A normalized candidate clip from either library, before download. */
interface Candidate {
  readonly source: StockSource;
  readonly downloadUrl: string;
  readonly width: number;
  readonly height: number;
  readonly durationSeconds: number;
  readonly creditUrl: string;
}

export class PexelsPixabayStockVideoProvider implements StockVideoProvider {
  readonly name = "pexels-pixabay-stock-video-provider";

  constructor(private readonly context: StockVideoContext = DEFAULT_CONTEXT) {}

  async find(request: StockVideoRequest): Promise<StockVideoResult> {
    const ctx: StockVideoContext = { ...this.context, ...request.context };
    const warnings: StockVideoWarning[] = [];
    const query = request.query.trim();
    if (query === "") {
      return { warnings: [{ code: "no-match", message: "Empty query.", segmentId: request.segmentId }] };
    }

    const pexelsKey = process.env.PEXELS_API_KEY;
    const pixabayKey = process.env.PIXABAY_API_KEY;
    if (!pexelsKey && !pixabayKey) {
      return { warnings: [{ code: "no-key", message: "No PEXELS_API_KEY or PIXABAY_API_KEY set.", segmentId: request.segmentId }] };
    }

    // Waterfall: Pexels first, then Pixabay. First source with a good clip wins.
    let best: Candidate | undefined;
    if (pexelsKey) {
      best = await this.searchPexels(query, pexelsKey, ctx, request, warnings);
    }
    if (!best && pixabayKey) {
      best = await this.searchPixabay(query, pixabayKey, ctx, request, warnings);
    }
    if (!best) {
      warnings.push({ code: "no-match", message: `No vertical clip for "${query}".`, segmentId: request.segmentId });
      return { warnings };
    }

    const clip = await this.download(best, ctx, request, warnings);
    return { ...(clip ? { clip } : {}), warnings };
  }

  /* --------------------------------- photos -------------------------------- */

  /**
   * Real PHOTOGRAPHS for a scene, same waterfall as clips: Pexels first, then
   * Pixabay. Downloaded stills are Ken-Burns'd by composition exactly like an AI
   * image — so a photo and a generated image are interchangeable downstream.
   */
  async findPhoto(request: StockVideoRequest): Promise<StockPhotoResult> {
    const ctx: StockVideoContext = { ...this.context, ...request.context };
    const warnings: StockVideoWarning[] = [];
    const query = request.query.trim();
    if (query === "") {
      return { warnings: [{ code: "no-match", message: "Empty query.", segmentId: request.segmentId }] };
    }

    const pexelsKey = process.env.PEXELS_API_KEY;
    const pixabayKey = process.env.PIXABAY_API_KEY;
    if (!pexelsKey && !pixabayKey) {
      return { warnings: [{ code: "no-key", message: "No stock API keys set.", segmentId: request.segmentId }] };
    }

    let best: PhotoCandidate | undefined;
    if (pexelsKey) {
      best = await this.searchPexelsPhotos(query, pexelsKey, request, warnings);
    }
    if (!best && pixabayKey) {
      best = await this.searchPixabayPhotos(query, pixabayKey, request, warnings);
    }
    if (!best) {
      warnings.push({ code: "no-match", message: `No vertical photo for "${query}".`, segmentId: request.segmentId });
      return { warnings };
    }

    try {
      await mkdir(ctx.outputDir, { recursive: true });
      const photoPath = join(ctx.outputDir, `${request.segmentId}.jpg`).replace(/\\/gu, "/");
      const bytes = await withRetry(async () => {
        const res = await fetch(best.downloadUrl, { signal: AbortSignal.timeout(45_000) });
        if (!res.ok) {
          throw new Error(`download ${res.status}`);
        }
        return Buffer.from(await res.arrayBuffer());
      }, { attempts: 2 });
      await writeFile(photoPath, bytes);
      return {
        photo: {
          segmentId: request.segmentId,
          photoPath,
          source: best.source,
          width: best.width,
          height: best.height,
          creditUrl: best.creditUrl,
        },
        warnings,
      };
    } catch (error) {
      warnings.push({ code: "download-failed", message: errMsg(error), segmentId: request.segmentId });
      return { warnings };
    }
  }

  private async searchPexelsPhotos(
    query: string,
    key: string,
    request: StockVideoRequest,
    warnings: StockVideoWarning[],
  ): Promise<PhotoCandidate | undefined> {
    try {
      const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&orientation=portrait&per_page=12`;
      const json = await withRetry(async () => {
        const res = await fetch(url, { headers: { Authorization: key }, signal: AbortSignal.timeout(20_000) });
        if (!res.ok) {
          throw new Error(`Pexels photos ${res.status}`);
        }
        return (await res.json()) as PexelsPhotoResponse;
      }, { attempts: 2 });

      const photos = (json.photos ?? []).filter((p) => (p.height ?? 0) > (p.width ?? 0));
      const chosen = photos.sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0];
      const link = chosen?.src?.portrait ?? chosen?.src?.large2x ?? chosen?.src?.large;
      if (!chosen || !link) {
        return undefined;
      }
      return {
        source: "pexels",
        downloadUrl: link,
        width: chosen.width ?? 0,
        height: chosen.height ?? 0,
        creditUrl: chosen.url ?? "https://pexels.com",
      };
    } catch (error) {
      warnings.push({ code: "search-failed", message: `Pexels photos: ${errMsg(error)}`, segmentId: request.segmentId });
      return undefined;
    }
  }

  private async searchPixabayPhotos(
    query: string,
    key: string,
    request: StockVideoRequest,
    warnings: StockVideoWarning[],
  ): Promise<PhotoCandidate | undefined> {
    try {
      const url = `https://pixabay.com/api/?key=${key}&q=${encodeURIComponent(query)}&image_type=photo&orientation=vertical&per_page=20&safesearch=true`;
      const json = await withRetry(async () => {
        const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
        if (!res.ok) {
          throw new Error(`Pixabay photos ${res.status}`);
        }
        return (await res.json()) as PixabayPhotoResponse;
      }, { attempts: 2 });

      const hit = (json.hits ?? []).find((h) => (h.imageHeight ?? 0) > (h.imageWidth ?? 0) && !!h.largeImageURL);
      if (!hit?.largeImageURL) {
        return undefined;
      }
      return {
        source: "pixabay",
        downloadUrl: hit.largeImageURL,
        width: hit.imageWidth ?? 0,
        height: hit.imageHeight ?? 0,
        creditUrl: hit.pageURL ?? "https://pixabay.com",
      };
    } catch (error) {
      warnings.push({ code: "search-failed", message: `Pixabay photos: ${errMsg(error)}`, segmentId: request.segmentId });
      return undefined;
    }
  }

  /* -------------------------------- Pexels -------------------------------- */

  private async searchPexels(
    query: string,
    key: string,
    ctx: StockVideoContext,
    request: StockVideoRequest,
    warnings: StockVideoWarning[],
  ): Promise<Candidate | undefined> {
    try {
      const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=portrait&per_page=12&size=medium`;
      const json = await withRetry(async () => {
        const res = await fetch(url, { headers: { Authorization: key }, signal: AbortSignal.timeout(20_000) });
        if (!res.ok) {
          throw new Error(`Pexels ${res.status}`);
        }
        return (await res.json()) as PexelsResponse;
      }, { attempts: 2 });

      const candidates: Candidate[] = [];
      for (const video of json.videos ?? []) {
        const file = pickBestFile(video.video_files ?? [], ctx.height);
        if (file && (video.height ?? 0) > (video.width ?? 0)) {
          candidates.push({
            source: "pexels",
            downloadUrl: file.link,
            width: file.width ?? video.width ?? 0,
            height: file.height ?? video.height ?? 0,
            durationSeconds: video.duration ?? 0,
            creditUrl: video.url ?? "https://pexels.com",
          });
        }
      }
      return chooseBest(candidates, request.neededSeconds, ctx.minDurationSeconds);
    } catch (error) {
      warnings.push({ code: "search-failed", message: `Pexels: ${errMsg(error)}`, segmentId: request.segmentId });
      return undefined;
    }
  }

  /* -------------------------------- Pixabay ------------------------------- */

  private async searchPixabay(
    query: string,
    key: string,
    ctx: StockVideoContext,
    request: StockVideoRequest,
    warnings: StockVideoWarning[],
  ): Promise<Candidate | undefined> {
    try {
      const url = `https://pixabay.com/api/videos/?key=${key}&q=${encodeURIComponent(query)}&per_page=20&safesearch=true`;
      const json = await withRetry(async () => {
        const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
        if (!res.ok) {
          throw new Error(`Pixabay ${res.status}`);
        }
        return (await res.json()) as PixabayResponse;
      }, { attempts: 2 });

      const candidates: Candidate[] = [];
      for (const hit of json.hits ?? []) {
        // Prefer the largest vertical rendition available for this hit.
        const renditions = [hit.videos?.large, hit.videos?.medium, hit.videos?.small, hit.videos?.tiny];
        const vertical = renditions.find((v): v is PixabayVideoFile => !!v && v.height > v.width && v.url !== "");
        if (vertical) {
          candidates.push({
            source: "pixabay",
            downloadUrl: vertical.url,
            width: vertical.width,
            height: vertical.height,
            durationSeconds: hit.duration ?? 0,
            creditUrl: hit.pageURL ?? "https://pixabay.com",
          });
        }
      }
      return chooseBest(candidates, request.neededSeconds, ctx.minDurationSeconds);
    } catch (error) {
      warnings.push({ code: "search-failed", message: `Pixabay: ${errMsg(error)}`, segmentId: request.segmentId });
      return undefined;
    }
  }

  /* ------------------------------- download ------------------------------- */

  private async download(
    candidate: Candidate,
    ctx: StockVideoContext,
    request: StockVideoRequest,
    warnings: StockVideoWarning[],
  ): Promise<StockClip | undefined> {
    try {
      await mkdir(ctx.outputDir, { recursive: true });
      const clipPath = join(ctx.outputDir, `${request.segmentId}.mp4`).replace(/\\/gu, "/");
      const bytes = await withRetry(async () => {
        const res = await fetch(candidate.downloadUrl, { signal: AbortSignal.timeout(60_000) });
        if (!res.ok) {
          throw new Error(`download ${res.status}`);
        }
        return Buffer.from(await res.arrayBuffer());
      }, { attempts: 2 });
      await writeFile(clipPath, bytes);
      return {
        segmentId: request.segmentId,
        clipPath,
        source: candidate.source,
        width: candidate.width,
        height: candidate.height,
        durationSeconds: candidate.durationSeconds,
        creditUrl: candidate.creditUrl,
      };
    } catch (error) {
      warnings.push({ code: "download-failed", message: errMsg(error), segmentId: request.segmentId });
      return undefined;
    }
  }
}

/* ------------------------------ selection ------------------------------ */

/** Prefer a clip that's long enough, then the one closest to target height. */
function chooseBest(candidates: readonly Candidate[], needed: number, minDuration: number): Candidate | undefined {
  const usable = candidates.filter((c) => c.durationSeconds >= minDuration);
  const pool = usable.length > 0 ? usable : candidates;
  if (pool.length === 0) {
    return undefined;
  }
  // Rank: clips >= needed length first, then higher resolution.
  return [...pool].sort((a, b) => {
    const aLong = a.durationSeconds >= needed ? 1 : 0;
    const bLong = b.durationSeconds >= needed ? 1 : 0;
    if (aLong !== bLong) {
      return bLong - aLong;
    }
    return b.height - a.height;
  })[0];
}

/** Pick the highest-res Pexels file at or below ~1.5x target height (avoid 4K). */
function pickBestFile(files: readonly PexelsVideoFile[], targetHeight: number): PexelsVideoFile | undefined {
  const portrait = files.filter((f) => (f.height ?? 0) > (f.width ?? 0) && (f.link ?? "") !== "");
  if (portrait.length === 0) {
    return undefined;
  }
  const cap = targetHeight * 1.5;
  const underCap = portrait.filter((f) => (f.height ?? 0) <= cap);
  const pool = underCap.length > 0 ? underCap : portrait;
  return [...pool].sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0];
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/* ------------------------------ API shapes ------------------------------ */

interface PexelsVideoFile {
  readonly link: string;
  readonly width?: number;
  readonly height?: number;
  readonly quality?: string;
  readonly file_type?: string;
}
interface PexelsVideo {
  readonly url?: string;
  readonly width?: number;
  readonly height?: number;
  readonly duration?: number;
  readonly video_files?: readonly PexelsVideoFile[];
}
interface PexelsResponse {
  readonly videos?: readonly PexelsVideo[];
}

interface PixabayVideoFile {
  readonly url: string;
  readonly width: number;
  readonly height: number;
}
interface PixabayHit {
  readonly pageURL?: string;
  readonly duration?: number;
  readonly videos?: {
    readonly large?: PixabayVideoFile;
    readonly medium?: PixabayVideoFile;
    readonly small?: PixabayVideoFile;
    readonly tiny?: PixabayVideoFile;
  };
}
interface PixabayResponse {
  readonly hits?: readonly PixabayHit[];
}

/** A normalized photo candidate from either library, before download. */
interface PhotoCandidate {
  readonly source: StockSource;
  readonly downloadUrl: string;
  readonly width: number;
  readonly height: number;
  readonly creditUrl: string;
}

interface PexelsPhoto {
  readonly url?: string;
  readonly width?: number;
  readonly height?: number;
  readonly src?: {
    readonly portrait?: string;
    readonly large2x?: string;
    readonly large?: string;
  };
}
interface PexelsPhotoResponse {
  readonly photos?: readonly PexelsPhoto[];
}

interface PixabayPhotoHit {
  readonly pageURL?: string;
  readonly largeImageURL?: string;
  readonly imageWidth?: number;
  readonly imageHeight?: number;
}
interface PixabayPhotoResponse {
  readonly hits?: readonly PixabayPhotoHit[];
}
