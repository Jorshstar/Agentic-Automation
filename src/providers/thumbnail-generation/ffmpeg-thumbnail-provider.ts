import { mkdir, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { runFfmpeg } from "../../lib/media.js";
import type { ThumbnailProvider } from "./thumbnail-provider.js";
import type {
  ThumbnailContext,
  ThumbnailRequest,
  GeneratedThumbnail,
  ThumbnailWarning,
  ThumbnailMetadata,
} from "./types.js";

/**
 * FfmpegThumbnailProvider — burns bold cover text onto a scene image.
 *
 * Fully local (FFmpeg + libass — the same proven path as the burned captions):
 * scale-crop the source image to each target size, overlay a one-cue ASS with
 * huge white text + black outline + a niche-accent glow, and write a JPEG.
 * Defensive: a missing image or failed render becomes a warning + "" path, never
 * a crash — a cover must never block a finished video.
 */

const DEFAULT_THUMBNAIL_CONTEXT: ThumbnailContext = {
  width: 1080,
  height: 1920,
  wideWidth: 1280,
  wideHeight: 720,
  fontName: "Arial",
  accentColor: "#FFFFFF",
  outputDir: "output/thumbnails",
};

export class FfmpegThumbnailProvider implements ThumbnailProvider {
  readonly name = "ffmpeg-thumbnail-provider";

  private lastResult: GeneratedThumbnail | undefined;

  constructor(private readonly context: ThumbnailContext = DEFAULT_THUMBNAIL_CONTEXT) {}

  /** The most recent covers produced (handy for demos/telemetry). */
  get last(): GeneratedThumbnail | undefined {
    return this.lastResult;
  }

  async generate(request: ThumbnailRequest): Promise<GeneratedThumbnail> {
    const ctx: ThumbnailContext = { ...this.context, ...request.context };
    const warnings: ThumbnailWarning[] = [];
    const startedAt = Date.now();
    const text = request.text.trim().toUpperCase();

    if (text === "") {
      warnings.push({ code: "empty-text", message: "No cover text; burning nothing was pointless — skipped." });
    }

    const fail = (message: string): GeneratedThumbnail => {
      const result: GeneratedThumbnail = {
        thumbnailPath: "",
        wideThumbnailPath: "",
        text,
        warnings: [...warnings, { code: "missing-image", message }],
        metadata: { provider: this.name, sourceImage: request.imagePath, latencyMs: Date.now() - startedAt },
      };
      this.lastResult = result;
      return result;
    };

    if (request.imagePath === "") {
      return fail("No source image provided.");
    }
    try {
      await access(request.imagePath);
    } catch {
      return fail(`Source image not found: "${request.imagePath}".`);
    }

    await mkdir(ctx.outputDir, { recursive: true });

    const thumbnailPath = await this.renderOne(request.imagePath, text, ctx, ctx.width, ctx.height, "thumbnail", warnings);
    const wideThumbnailPath = await this.renderOne(request.imagePath, text, ctx, ctx.wideWidth, ctx.wideHeight, "thumbnail-wide", warnings);

    const result: GeneratedThumbnail = {
      thumbnailPath,
      wideThumbnailPath,
      text,
      warnings,
      metadata: { provider: this.name, sourceImage: request.imagePath, latencyMs: Date.now() - startedAt },
    };
    this.lastResult = result;
    return result;
  }

  /** Render one cover at the given size. Returns "" (plus a warning) on failure. */
  private async renderOne(
    imagePath: string,
    text: string,
    ctx: ThumbnailContext,
    width: number,
    height: number,
    baseName: string,
    warnings: ThumbnailWarning[],
  ): Promise<string> {
    const outputPath = join(ctx.outputDir, `${baseName}.jpg`);

    let vf = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
    if (text !== "") {
      // The subtitles filter needs a forward-slash RELATIVE path (a drive colon
      // breaks filter parsing) — same rule as the caption burn in composition.
      const assPath = join(ctx.outputDir, `${baseName}.ass`).replace(/\\/gu, "/");
      await writeFile(assPath, renderCoverAss(text, ctx, width, height), "utf8");
      vf += `,subtitles=${assPath}`;
    }

    const run = await runFfmpeg([
      "-y",
      "-loop", "1",
      "-t", "1",
      "-i", imagePath,
      "-vf", vf,
      "-frames:v", "1",
      "-q:v", "3",
      outputPath,
    ]);

    if (!run.ok) {
      warnings.push({ code: "render-failed", message: `${baseName} render failed: ${run.stderr}` });
      return "";
    }
    return outputPath.replace(/\\/gu, "/");
  }
}

/* --------------------------------- ASS text --------------------------------- */

/** One-cue ASS: huge centered white text, thick black outline, accent glow. */
function renderCoverAss(text: string, ctx: ThumbnailContext, width: number, height: number): string {
  const fontSize = Math.round(Math.min(width, height) / (width < height ? 6.5 : 5.5));
  const marginH = Math.round(width * 0.06);
  const outline = Math.max(6, Math.round(fontSize / 14));
  const shadow = Math.max(3, Math.round(outline / 2));
  const white = "&H00FFFFFF";
  const black = "&H00000000";
  const glow = hexToAssColor(ctx.accentColor, "30");

  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    // Alignment 5 = middle-center: the text sits over the image's focal area.
    `Style: Cover,${ctx.fontName},${fontSize},${white},${white},${black},${glow},1,0,0,0,100,100,2,0,1,${outline},${shadow},5,${marginH},${marginH},0,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    `Dialogue: 0,0:00:00.00,0:00:05.00,Cover,,0,0,0,,${text.replace(/[{}]/gu, "")}`,
    "",
  ].join("\n");
}

/** Convert "#RRGGBB" to an ASS colour "&HAABBGGRR". */
function hexToAssColor(hex: string, alpha = "00"): string {
  const cleaned = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/u.test(cleaned)) {
    return `&H${alpha}FFFFFF`;
  }
  const r = cleaned.slice(0, 2);
  const g = cleaned.slice(2, 4);
  const b = cleaned.slice(4, 6);
  return `&H${alpha}${b}${g}${r}`.toUpperCase();
}
