/**
 * Stock-video demo — verify the Pexels/Pixabay waterfall for a few queries.
 *
 * Cheap and standalone: searches each query, downloads the winning vertical clip,
 * and reports the source + size. Great for checking your API keys work before a
 * full run.
 *
 *   npm run demo:stock                       (default sample queries)
 *   npm run demo:stock -- "rainy city night" "old abandoned house"
 */
import { PexelsPixabayStockVideoProvider } from "../providers/stock-video/index.js";
import { logger } from "../lib/logger.js";

try {
  process.loadEnvFile();
} catch {
  // No .env — fall back to the ambient environment.
}

async function main(): Promise<void> {
  if (!process.env.PEXELS_API_KEY && !process.env.PIXABAY_API_KEY) {
    logger.warn("Set PEXELS_API_KEY and/or PIXABAY_API_KEY in .env to test stock footage.");
    return;
  }

  const queries = process.argv.slice(2);
  const samples = queries.length > 0 ? queries : ["rainy city street night", "misty forest morning", "server room technology"];

  const provider = new PexelsPixabayStockVideoProvider({
    width: 1080, height: 1920, minDurationSeconds: 4, outputDir: "output/stock/demo",
  });

  for (const [i, query] of samples.entries()) {
    const res = await provider.find({ segmentId: `demo-${i + 1}`, query, neededSeconds: 6 });
    console.log(`\n"${query}"`);
    if (res.clip) {
      const c = res.clip;
      console.log(`  ✓ ${c.source}: ${c.clipPath}  (${c.width}x${c.height}, ${c.durationSeconds}s)`);
      console.log(`    credit: ${c.creditUrl}`);
    } else {
      console.log("  ✗ no clip");
    }
    for (const w of res.warnings) {
      console.log(`    ! [${w.code}] ${w.message}`);
    }
  }
  console.log("\nDone. Clips are in output/stock/demo/ — open them to check quality.");
}

main().catch((error: unknown) => {
  logger.error("Stock demo failed", { error: String(error) });
  process.exitCode = 1;
});
