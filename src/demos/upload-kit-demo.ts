/**
 * Rebuild the upload kit for a part that already exists.
 *
 *   npm run kit -- output/longform/<series>/part-1
 *   npm run kit -- output/longform/<series>/part-1 --send
 *
 * Every part now writes script.json beside its video, which is what makes this
 * possible: the words can be regenerated without re-rendering a thing. That
 * matters because the expensive half of a part is the voice and the images,
 * and the half most likely to need another go is the text.
 *
 * Without --send it only prints, so you can look before anything reaches the
 * chat. The rewritten kit replaces upload-kit.txt either way.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ClaudeSeoProvider } from "../providers/seo/index.js";
import { createClaudeAIKernel } from "../ai/index.js";
import { uploadKitMessages } from "../longform/upload-kit.js";
import { TelegramDeliveryProvider } from "../providers/delivery/index.js";

try {
  process.loadEnvFile();
} catch {
  /* ambient env */
}

interface SavedScript {
  readonly title: string;
  readonly summary: string;
  readonly beats: readonly { readonly text: string }[];
}

async function main(): Promise<void> {
  const flags = process.argv.filter((argument) => argument.startsWith("--"));
  const [partDir] = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
  if (!partDir) {
    console.error("Usage: npm run kit -- <part directory> [--send]");
    process.exitCode = 1;
    return;
  }

  let script: SavedScript;
  try {
    script = JSON.parse(await readFile(join(partDir, "script.json"), "utf8")) as SavedScript;
  } catch {
    console.error(
      `No script.json in ${partDir}. Parts rendered before it was saved cannot be rebuilt — ` +
        "run the part again.",
    );
    process.exitCode = 1;
    return;
  }

  const narration = script.beats.map((beat) => beat.text).join(" ");
  const pack = await new ClaudeSeoProvider(createClaudeAIKernel()).generate({
    topic: script.title,
    hook: script.beats[0]?.text ?? "",
    script: narration,
    niche: "documentary",
    tone: "dry, factual, narrative",
    audience: "people who like well-researched explainer videos",
    keywords: [script.title],
    durationSeconds: Math.round(narration.split(/\s+/u).length / 2.6),
    platform: "YouTube",
    format: "longform",
  });

  const messages = uploadKitMessages({
    youtubeTitle: pack.youtube.title,
    youtubeDescription: pack.youtube.description,
    tags: pack.youtube.tags,
    hashtags: pack.youtube.hashtags,
  });

  for (const message of messages) console.log(`${message}\n`);
  if (pack.warnings.length > 0) console.log("warnings:", JSON.stringify(pack.warnings));

  await writeFile(join(partDir, "upload-kit.txt"), messages.join("\n\n"), "utf8");
  console.log(`written to ${join(partDir, "upload-kit.txt")}`);

  if (flags.includes("--send")) {
    const telegram = new TelegramDeliveryProvider();
    for (const message of messages) await telegram.notify(message);
    console.log(`sent ${messages.length} message(s)`);
  }
}

main().catch((error: unknown) => {
  console.error("kit failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
