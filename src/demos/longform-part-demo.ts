/**
 * Produce the NEXT part of a documentary series.
 *
 *   npm run longform:part -- "the history of Nintendo"      # part 1
 *   npm run longform:part -- "the history of Nintendo"      # part 2, next day
 *   npm run longform:part -- --list                         # what is in progress
 *
 * Run it again with the same topic and you get the next part: the series store
 * remembers what has been covered and the writer continues rather than
 * restarting.
 */
import { runPart } from "../longform/run-part.js";
import { createSeriesStore } from "../longform/series.js";

try {
  process.loadEnvFile();
} catch {
  /* ambient env */
}

async function main(): Promise<void> {
  const flags = process.argv.filter((argument) => argument.startsWith("--"));
  const positional = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
  const store = createSeriesStore();

  if (flags.includes("--list")) {
    const all = await store.list();
    if (all.length === 0) {
      console.log("No series yet.");
      return;
    }
    for (const record of all) {
      console.log(`\n${record.topic}${record.complete ? "  (complete)" : ""}`);
      for (const part of record.parts) {
        console.log(`  ${part.part}. ${part.title}`);
      }
    }
    return;
  }

  const topic = positional[0];
  if (!topic) {
    console.error('Usage: npm run longform:part -- "<topic>" [seconds]   |   --list');
    process.exitCode = 1;
    return;
  }
  const targetSeconds = Number(positional[1] ?? 55);

  const result = await runPart(
    { topic, targetSeconds, onStep: (message) => console.log(message) },
    store,
  );

  console.log(`\nPart ${result.part}: "${result.title}"`);
  console.log(`${result.videoPath}  ${result.durationSeconds.toFixed(1)}s`);
  console.log(`${result.beats} beats, ${result.flagged} flagged, $${result.imagesCostUsd.toFixed(2)} of images`);
  console.log(`Sources: ${result.citations.join(", ")}`);
  console.log(
    result.complete
      ? "\nThe writer considers this series finished."
      : `\nRun it again for part ${result.part + 1}.`,
  );
}

main().catch((error: unknown) => {
  console.error("part failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
