import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ConfigurationError } from "../../lib/errors.js";
import { withRetry } from "../../lib/retry.js";
import type { ImageGenerationProvider } from "./image-generation-provider.js";
import type {
  ImageGenerationContext,
  ImageGenerationRequest,
  GeneratedImage,
  GeneratedImages,
  ImageGenerationWarning,
  ImageGenerationWarningCode,
  ImageGenerationMetadata,
  ImageFormat,
} from "./types.js";

/**
 * OpenAIImageGenerationProvider — generates a real image per segment via OpenAI
 * Images.
 *
 * PRODUCTION stage: real network + disk. Native `fetch`, no SDK, no AI Kernel
 * (that's for Claude text). Defensive: a per-image failure becomes a structured
 * warning and a skipped file; a bad/missing key fails fast and clearly. Each
 * request has its own timeout so one slow image can't hang the run.
 */

const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations";
const PER_IMAGE_TIMEOUT_MS = 120_000;

/** Defaults: gpt-image-1 portrait (1024x1536 ≈ 2:3, good base for a 9:16 short). */
const DEFAULT_IMAGE_CONTEXT: ImageGenerationContext = {
  model: "gpt-image-1",
  size: "1024x1536",
  quality: "medium",
  format: "png",
  styleSuffix: "Vertical 9:16 composition, cinematic, no text or letters in the image.",
  outputDir: "output/assets/images",
};

export class OpenAIImageGenerationProvider implements ImageGenerationProvider {
  readonly name = "openai-image-generation-provider";

  private lastResult: GeneratedImages | undefined;

  constructor(private readonly context: ImageGenerationContext = DEFAULT_IMAGE_CONTEXT) {}

  /** The most recent result produced (handy for demos/telemetry). */
  get last(): GeneratedImages | undefined {
    return this.lastResult;
  }

  async generate(request: ImageGenerationRequest): Promise<GeneratedImages> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || apiKey.trim() === "") {
      throw new ConfigurationError(
        "OPENAI_API_KEY is not set. Add it to .env (from https://platform.openai.com/api-keys).",
      );
    }

    const context: ImageGenerationContext = { ...this.context, ...request.context };
    await mkdir(context.outputDir, { recursive: true });
    const { width, height } = parseSize(context.size);

    const warnings: ImageGenerationWarning[] = [];
    const images: GeneratedImage[] = [];
    let totalBytes = 0;
    const startedAt = Date.now();

    for (const segment of request.assetPlan.segments) {
      const basePrompt = segment.visualPrompt.trim();
      if (basePrompt === "") {
        warnings.push({ code: "empty-prompt", message: "Segment has no visual prompt.", segmentId: segment.segmentId });
        continue;
      }

      const prompt = `${basePrompt}\n\n${context.styleSuffix}`;
      const imagePath = join(context.outputDir, `${segment.segmentId}.${context.format}`);

      try {
        // Transient image failures (429/5xx/timeouts) retry with backoff; a bad
        // key (ConfigurationError) fails immediately. Images are the most
        // expensive stage, so a hiccup must not cost a whole segment.
        const bytes = await withRetry(() => generateOneImage(apiKey, context, prompt));
        await writeFile(imagePath, bytes);
        totalBytes += bytes.length;
        images.push({
          segmentId: segment.segmentId,
          prompt,
          imagePath,
          status: "generated",
          model: context.model,
          format: context.format,
          width,
          height,
          bytes: bytes.length,
        });
      } catch (error) {
        if (error instanceof ConfigurationError) {
          throw error; // auth/access failure — stop clearly
        }
        const code: ImageGenerationWarningCode =
          error instanceof DecodeError ? "decode-failed" : "generation-failed";
        warnings.push({
          code,
          message: error instanceof Error ? error.message : String(error),
          segmentId: segment.segmentId,
        });
        images.push({
          segmentId: segment.segmentId,
          prompt,
          imagePath: "",
          status: "failed",
          model: context.model,
          format: context.format,
          width,
          height,
          bytes: 0,
        });
      }
    }

    const generatedCount = images.filter((image) => image.status === "generated").length;
    const metadata: ImageGenerationMetadata = {
      provider: "openai",
      model: context.model,
      size: context.size,
      quality: context.quality,
      requested: request.assetPlan.segments.length,
      generated: generatedCount,
      totalBytes,
      latencyMs: Date.now() - startedAt,
    };

    const result: GeneratedImages = { images, outputDir: context.outputDir, warnings, metadata };
    this.lastResult = result;
    return result;
  }
}

/** Thrown when the API response can't be decoded into image bytes. */
class DecodeError extends Error {}

/** Call OpenAI Images once and return the decoded image bytes. Never logs the key. */
async function generateOneImage(
  apiKey: string,
  context: ImageGenerationContext,
  prompt: string,
): Promise<Buffer> {
  const body: Record<string, unknown> = {
    model: context.model,
    prompt,
    size: context.size,
    n: 1,
    quality: context.quality,
  };

  let response: Response;
  try {
    response = await fetch(OPENAI_IMAGES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(PER_IMAGE_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`image request failed (network/timeout): ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!response.ok) {
    const detail = await safeErrorDetail(response);
    if (response.status === 401 || response.status === 403) {
      throw new ConfigurationError(
        `OpenAI rejected the request (${response.status}). Check OPENAI_API_KEY / image access. ${detail}`,
      );
    }
    throw new Error(`OpenAI Images failed (${response.status}). ${detail}`);
  }

  // The images endpoint returns either inline base64 (gpt-image-*) or a short-
  // lived URL (dall-e-*). Handle both so the model choice doesn't matter.
  const payload = await response.json();
  const base64 = extractString(payload, "b64_json");
  if (base64 !== undefined) {
    return Buffer.from(base64, "base64");
  }
  const url = extractString(payload, "url");
  if (url !== undefined) {
    return downloadBytes(url);
  }
  throw new DecodeError("response contained neither b64_json nor url.");
}

/** Download image bytes from a returned URL. */
async function downloadBytes(url: string): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(PER_IMAGE_TIMEOUT_MS) });
  if (!response.ok) {
    throw new DecodeError(`failed to download generated image (${response.status}).`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/** Safely pull `data[0].<field>` (b64_json or url) from an unknown JSON payload. */
function extractString(payload: unknown, field: "b64_json" | "url"): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length === 0) {
    return undefined;
  }
  const first = data[0];
  if (!first || typeof first !== "object") {
    return undefined;
  }
  const value = (first as Record<string, unknown>)[field];
  return typeof value === "string" && value !== "" ? value : undefined;
}

async function safeErrorDetail(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 400);
  } catch {
    return "";
  }
}

/** Parse "1024x1792" into { width, height }, tolerating junk. */
function parseSize(size: string): { readonly width: number; readonly height: number } {
  const match = size.match(/^(\d+)x(\d+)$/u);
  if (!match) {
    return { width: 1024, height: 1792 };
  }
  return { width: Number(match[1]), height: Number(match[2]) };
}
