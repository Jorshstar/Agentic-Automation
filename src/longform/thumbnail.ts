import { mkdir } from "node:fs/promises";
import { OpenAIImageGenerationProvider } from "../providers/image-generation/index.js";
import { FfmpegThumbnailProvider } from "../providers/thumbnail-generation/index.js";
import type { AssetPlan } from "../providers/asset-planning/index.js";
import type { AIKernel } from "../ai/index.js";
import { createClaudeAIKernel } from "../ai/index.js";
import { textProviderOptions } from "../ai/text-provider.js";

/**
 * THUMBNAIL — a purpose-made cover, not a reused frame.
 *
 * A frame lifted from the video is composed for storytelling: the subject sits
 * mid-action, the framing is wide, and at the size a thumbnail is actually seen
 * none of it reads. A cover has one job — stop a thumb mid-scroll — and that
 * wants a different picture: one focal subject, close, high contrast, and empty
 * space held open on one side for the text.
 *
 * So the illustration is generated specifically, in the same locked style as
 * the video, and the TEXT is burned on afterwards with ffmpeg rather than asked
 * of the image model. Models render words unreliably, and a cover with mangled
 * lettering is worse than none; burning it is deterministic and always legible.
 *
 * An extra image costs about three cents against a part that costs twenty-seven.
 */

export interface ThumbnailResult {
  /** 16:9 cover for YouTube. Empty when it could not be made. */
  readonly widePath: string;
  /** The words burned onto it. */
  readonly text: string;
  /** What the illustration shows, for logs. */
  readonly scene: string;
}

const COVER_PROMPT_ID = "longform-thumbnail.user";
const COVER_SYSTEM_PROMPT_ID = "longform-thumbnail.system";

/**
 * Composition rules appended to the locked art style.
 *
 * These are what separate a cover from a scene: one subject rather than a
 * tableau, close enough to read small, and a deliberately empty third for the
 * text to sit in without covering anything that matters.
 */
const COVER_COMPOSITION = [
  "Thumbnail composition: ONE clear focal subject, framed close and large,",
  "filling the left two thirds of the frame. Keep the right third visually calm",
  "and uncluttered — simple background, no important detail — so text can sit there.",
  "Strong readable silhouette, high contrast, bold shapes that stay legible when",
  "the image is shown very small. Dramatic but not cluttered.",
].join(" ");

export interface ThumbnailRequest {
  readonly title: string;
  readonly topic: string;
  readonly part: number;
  /** The narration, so the cover shows a moment that is actually in the video. */
  readonly script: string;
  /** The locked art style, so the cover matches the video. */
  readonly style: string;
  readonly outputDir: string;
}

export class LongformThumbnailMaker {
  private readonly kernel: AIKernel;

  constructor(kernel?: AIKernel) {
    this.kernel = kernel ?? createClaudeAIKernel();
  }

  async make(request: ThumbnailRequest): Promise<ThumbnailResult> {
    await mkdir(request.outputDir, { recursive: true });

    const plan = await this.planCover(request);
    const scene = plan.scene || `A single figure central to ${request.topic}, close up and dramatic.`;
    const text = plan.text || shortenTitle(request.title);

    // 1. the illustration, in the video's own style plus cover composition
    const images = await new OpenAIImageGenerationProvider().generate({
      assetPlan: {
        segments: [
          {
            segmentId: "cover",
            assetType: "image",
            primaryProvider: "openai",
            fallbackProvider: "openai",
            searchQueries: [],
            visualPrompt: scene,
            estimatedDuration: 0,
            licenseRequirements: "generated",
            notes: "",
          },
        ],
      } as unknown as AssetPlan,
      context: {
        // 16:9 so no crop is needed to reach thumbnail shape.
        size: "1536x1024",
        quality: process.env.LONGFORM_IMAGE_QUALITY?.trim() || "medium",
        styleSuffix: `${request.style} ${COVER_COMPOSITION}`,
        outputDir: request.outputDir,
      },
    });

    const cover = images.images.find((image) => image.status === "generated");
    if (!cover || cover.imagePath === "") {
      return { widePath: "", text, scene };
    }

    // 2. the words, burned on — never asked of the image model
    const burned = await new FfmpegThumbnailProvider().generate({
      imagePath: cover.imagePath,
      text,
      context: { outputDir: request.outputDir },
    });

    return {
      // Falling back to the un-lettered illustration is deliberate: a cover
      // without words still works, a missing cover does not.
      widePath: burned.wideThumbnailPath || cover.imagePath,
      text: burned.text || text,
      scene,
    };
  }

  /** Ask for the cover scene and the handful of words that go on it. */
  private async planCover(request: ThumbnailRequest): Promise<{ scene: string; text: string }> {
    try {
      const generated = await this.kernel.generate({
        promptId: COVER_PROMPT_ID,
        systemPromptId: COVER_SYSTEM_PROMPT_ID,
        variables: {
          title: request.title,
          topic: request.topic,
          part: request.part,
          script: request.script.slice(0, 4000),
        },
        expectedOutput: { format: "json", description: "a thumbnail scene and caption" },
        maxTokens: 2000,
        ...textProviderOptions("LONGFORM_THUMBNAIL_MODEL"),
      });

      let root: unknown = generated.output;
      if (typeof root === "string") {
        root = JSON.parse(root.trim().replace(/^```(?:json)?/iu, "").replace(/```$/u, "").trim());
      }
      const record = (root ?? {}) as Record<string, unknown>;
      return {
        scene: typeof record["scene"] === "string" ? record["scene"].trim() : "",
        // Four words is the practical ceiling for something read at thumbnail
        // size; more becomes a line of text nobody reads.
        text: typeof record["text"] === "string" ? limitWords(record["text"].trim(), 4) : "",
      };
    } catch {
      // A cover must never block a finished video.
      return { scene: "", text: "" };
    }
  }
}

function limitWords(text: string, max: number): string {
  const words = text.replace(/["']/gu, "").split(/\s+/u).filter(Boolean);
  return words.slice(0, max).join(" ").toUpperCase();
}

/** Fallback cover text: the punchiest few words of the title. */
function shortenTitle(title: string): string {
  const cleaned = title.replace(/^(part\s*\d+\s*[:\-–]\s*)/iu, "");
  return limitWords(cleaned.split(/[:\-–]/u)[0] ?? cleaned, 4);
}
