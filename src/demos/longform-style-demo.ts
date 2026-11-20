/**
 * STYLE PROBE for the long-form documentary format.
 *
 *   npm run longform:style
 *
 * Generates a handful of images from consecutive beats of one chapter, using a
 * single locked style descriptor, and writes them to one folder so they can be
 * looked at TOGETHER.
 *
 * Why this runs before any of the format is built: consistency across ~137
 * images is the only thing that genuinely threatens this format, and it cannot
 * be judged one image at a time. Each image in isolation looks fine; the failure
 * is DRIFT — line weight, palette and character design sliding apart over a
 * sequence. Ten images side by side answer it for well under a dollar, and if
 * the style does not hold across ten it will not hold across a hundred.
 *
 * The beats below are real narration beats from the reference video, so the
 * prompts are the kind the scene planner would actually produce.
 */
import { mkdir } from "node:fs/promises";
import { OpenAIImageGenerationProvider } from "../providers/image-generation/index.js";
import type { AssetPlan } from "../providers/asset-planning/index.js";

try {
  process.loadEnvFile();
} catch {
  /* ambient env */
}

/**
 * The locked visual identity. Every prompt gets this appended verbatim — it is
 * the whole consistency mechanism, so it pins line, colour, faces and framing
 * rather than describing a vague mood.
 *
 * "No text" is deliberate. The reference has hand-lettered speech bubbles, but
 * image models render words unreliably; drawing empty bubbles here and burning
 * the text on afterwards is deterministic and always legible.
 */
const STYLE = [
  "Hand-drawn 2D cartoon illustration in a flat webcomic style.",
  "Bold uniform black ink outlines, clean line art, subtle paper grain texture.",
  "Characters are simple everyman figures with plain rounded heads, small dot eyes,",
  "simple expressive mouths, and NO detailed facial features.",
  "Muted warm palette: burnt orange, cream, soft brown, sage green, dusty teal.",
  "Richly detailed background environment drawn in the same line weight as the characters.",
  "Soft even lighting, no photorealism, no 3D render, no anime.",
  "Wide 16:9 composition with the main action centred.",
  "Absolutely no text, no letters, no numbers, no writing anywhere in the image.",
].join(" ");

/** Consecutive beats from one chapter, as the scene planner would emit them. */
const BEATS: readonly string[] = [
  "A man in a shirt and tie sits at a desk in a 1990s corner office, staring at a computer showing a rising line chart, looking restless and unsatisfied.",
  "The same man loads cardboard boxes into the back of a car outside a suburban house at dawn, his wife watching from the doorway.",
  "The man builds wooden desks from a door laid across sawhorses inside a cluttered garage, surrounded by stacks of books.",
  "Three people crowd around a single beige computer in the garage, celebrating as a small bell rings above them.",
  "A delivery van pulls away from the garage, overloaded with brown parcels stacked far too high.",
  "A nervous man in a suit presents to a boardroom of sceptical investors, pointing at a chart that drops sharply downward.",
  "A vast warehouse interior with endless shelving stretching into the distance, tiny workers pushing carts between the aisles.",
  "The same man, older now, stands on a stage in front of a huge audience, arms raised in triumph.",
];

async function main(): Promise<void> {
  const outputDir = "output/longform-style";
  await mkdir(outputDir, { recursive: true });

  const assetPlan = {
    segments: BEATS.map((visualPrompt, index) => ({
      segmentId: `beat-${String(index + 1).padStart(2, "0")}`,
      assetType: "image",
      primaryProvider: "openai",
      fallbackProvider: "openai",
      searchQueries: [],
      visualPrompt,
      estimatedDuration: 6,
      licenseRequirements: "generated",
      notes: "",
    })),
  } as unknown as AssetPlan;

  console.log(`Generating ${BEATS.length} images at 1536x1024 (landscape)…`);
  console.log(`Estimated cost: $${(BEATS.length * 0.07).toFixed(2)}\n`);

  const provider = new OpenAIImageGenerationProvider();
  const started = Date.now();
  const result = await provider.generate({
    assetPlan,
    context: {
      // Landscape: this format is 16:9, unlike the vertical shorts.
      size: "1536x1024",
      quality: "medium",
      styleSuffix: STYLE,
      outputDir,
    },
  });

  for (const image of result.images) {
    console.log(
      `  ${image.status === "generated" ? "OK  " : "FAIL"} ${image.segmentId}  ` +
        `${image.width}x${image.height}  ${(image.bytes / 1000).toFixed(0)}KB`,
    );
  }
  for (const warning of result.warnings) {
    console.log(`  WARN ${warning.segmentId ?? ""} ${warning.code}: ${warning.message.slice(0, 120)}`);
  }
  console.log(
    `\n${result.images.filter((i) => i.status === "generated").length}/${BEATS.length} in ` +
      `${Math.round((Date.now() - started) / 1000)}s — ${outputDir}`,
  );
  console.log("Look at them TOGETHER: line weight, palette and face design must match.");
}

main().catch((error: unknown) => {
  console.error("style probe failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
