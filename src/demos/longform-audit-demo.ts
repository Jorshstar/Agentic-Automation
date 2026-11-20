/**
 * SCRIPT AUDIT — research, write and fact-check across several topics, with no
 * images and no video.
 *
 *   npm run longform:audit
 *   npm run longform:audit -- "the history of Nintendo" "the Dancing Plague of 1518"
 *
 * The question this answers is whether the fact checker WORKS, and that cannot
 * be answered by one run. A checker that passes everything looks exactly like a
 * checker that is working: both produce a clean script and a confident log. The
 * only way to tell them apart is to read a lot of output.
 *
 * So this prints the full script and every verdict, and deliberately includes
 * topics chosen to be hostile:
 *   - heavily mythologised events, where the popular story is wrong and a model
 *     writing from memory would recite it;
 *   - topics with contested or uncertain numbers;
 *   - an obscure topic, to see what happens when sources are thin.
 *
 * Skipping images keeps a full audit near a cent per topic instead of a dollar,
 * so there is no reason not to read them all.
 */
import { research } from "../longform/research.js";
import { LongformScriptWriter } from "../longform/script.js";
import { ScriptVerifier } from "../longform/verify.js";

try {
  process.loadEnvFile();
} catch {
  /* ambient env */
}

/**
 * Chosen for the gap between the popular story and the record.
 *
 * Tulip Mania: "worth its weight in gold" is a myth.
 * Dancing Plague: real event, wildly embellished retellings.
 * Great Emu War: usually told as farce; the numbers are often invented.
 * Radium Girls: real and grim, and the figures get exaggerated.
 * Nintendo: the playing-cards-to-games arc attracts invented detail.
 */
const DEFAULT_TOPICS: readonly string[] = [
  "the Dancing Plague of 1518",
  "the Great Emu War in Australia",
  "the Radium Girls",
  "the history of Nintendo before video games",
  "the Mary Celeste ghost ship",
];

async function auditTopic(topic: string): Promise<{ beats: number; flagged: number; grounded: boolean }> {
  console.log(`\n${"=".repeat(72)}\n${topic}\n${"=".repeat(72)}`);

  const sources = await research(topic);
  const grounded = sources.articles.length > 0;
  console.log(
    grounded
      ? `sources: ${sources.articles.map((article) => article.title).join(" | ")}`
      : "sources: NONE — script will be ungrounded",
  );

  const script = await new LongformScriptWriter().write({
    topic,
    targetSeconds: 55,
    sourceText: sources.sourceText,
  });
  if (script.beats.length === 0) {
    console.log("writer returned nothing usable");
    return { beats: 0, flagged: 0, grounded };
  }

  const verified = await new ScriptVerifier().verify(script.beats, sources.sourceText);
  console.log(`"${script.title}" — ${script.beats.length} beats, ${script.estimatedWords} words\n`);

  const byIndex = new Map(verified.checks.map((check) => [check.index, check]));
  for (const [index, beat] of script.beats.entries()) {
    const check = byIndex.get(index);
    const mark = !check ? "?" : check.verdict === "supported" ? " " : "!";
    console.log(`${mark} ${index + 1}. ${beat.text}`);
    if (check && check.verdict !== "supported") {
      console.log(`     ${check.verdict}: ${check.problem}`);
      console.log(check.correction ? `     fixed: ${check.correction}` : "     DROPPED");
    }
  }

  if (verified.checks.length === 0) {
    console.log("\n  NOT CHECKED — treat every fact above as unverified");
  }
  return { beats: script.beats.length, flagged: verified.problems.length, grounded };
}

async function main(): Promise<void> {
  const topics = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
  const list = topics.length > 0 ? topics : DEFAULT_TOPICS;

  let totalBeats = 0;
  let totalFlagged = 0;
  let ungrounded = 0;

  for (const topic of list) {
    try {
      const result = await auditTopic(topic);
      totalBeats += result.beats;
      totalFlagged += result.flagged;
      if (!result.grounded) ungrounded++;
    } catch (error) {
      console.log(`  FAILED: ${error instanceof Error ? error.message.slice(0, 160) : error}`);
    }
  }

  console.log(`\n${"=".repeat(72)}`);
  console.log(`${list.length} topics · ${totalBeats} beats · ${totalFlagged} flagged`);
  if (ungrounded > 0) console.log(`${ungrounded} topic(s) had no sources`);
  console.log(
    "A flag rate near zero across hostile topics means the checker is rubber-stamping,\n" +
      "not that the scripts are clean. Read the beats, not the number.",
  );
}

main().catch((error: unknown) => {
  console.error("audit failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
