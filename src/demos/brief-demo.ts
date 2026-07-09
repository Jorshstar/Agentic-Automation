/**
 * Brief CLI — command the studio in plain words (Phase 2).
 *
 *   npm run studio:brief -- "a calm bedtime history video about the fall of Rome"
 *   npm run studio:brief -- "top 3 AI tools this week" --niche tech-news
 *   npm run studio:brief -- "a motivational video about discipline" --duration 90
 *   npm run studio:brief -- "The Last Voicemail" --title --niche scary-stories
 *   npm run studio:brief -- "..." --dry        (preview the designed identity, no video)
 *
 * With no --niche, an AI identity designer creates a one-off show identity
 * (voice, look, music, captions) from your instructions (~1¢). --dry stops
 * after that preview so you can check the identity before spending on a video.
 */
import { resolveBrief, runResolvedBrief } from "../studio/content-brief.js";
import type { ContentBrief } from "../studio/content-brief.js";
import { NICHE_PROFILES } from "../config/niche-profiles.js";
import { isVideoFormat, VIDEO_FORMATS } from "../studio/formats.js";
import type { VideoFormat } from "../studio/formats.js";
import { isFfprobeAvailable } from "../lib/media.js";
import type { PresetNiche } from "../types/index.js";
import { logger } from "../lib/logger.js";

try {
  process.loadEnvFile();
} catch {
  // No .env — fall back to the ambient environment.
}

interface CliArgs {
  readonly instructions: string;
  readonly niche?: PresetNiche;
  readonly durationSeconds?: number;
  readonly format?: VideoFormat;
  readonly exactTitle: boolean;
  readonly dry: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const positionals: string[] = [];
  let niche: PresetNiche | undefined;
  let durationSeconds: number | undefined;
  let exactTitle = false;
  let dry = false;
  let format: VideoFormat | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    // npm on this machine EATS `--flags` after `--` (proven three times), so
    // key=value forms are supported too: duration=90 niche=tech-news dry=yes
    const kv = arg.match(/^(duration|niche|dry|title|format)=(.+)$/u);
    if (kv) {
      const [, key, value] = kv;
      if (key === "dry") {
        dry = /^(yes|true|1)$/iu.test(value ?? "");
      } else if (key === "title") {
        exactTitle = /^(yes|true|1)$/iu.test(value ?? "");
      } else if (key === "duration") {
        const n = Number(value);
        if (!Number.isFinite(n) || n < 15 || n > 600) {
          console.error(`✗ duration must be 15-600 seconds (got "${value}").`);
          process.exit(1);
        }
        durationSeconds = n;
      } else if (key === "niche") {
        if (!((value ?? "") in NICHE_PROFILES)) {
          console.error(`✗ Unknown niche "${value}". Valid: ${Object.keys(NICHE_PROFILES).join(", ")}`);
          process.exit(1);
        }
        niche = value as PresetNiche;
      } else if (key === "format") {
        if (!isVideoFormat(value)) {
          console.error(`✗ Unknown format "${value}". Valid: ${VIDEO_FORMATS.join(", ")}`);
          process.exit(1);
        }
        format = value;
      }
    } else if (arg === "--dry") {
      dry = true;
    } else if (arg === "--title") {
      exactTitle = true;
    } else if (arg === "--duration") {
      const value = Number(argv[i + 1]);
      i += 1;
      if (!Number.isFinite(value) || value < 15 || value > 600) {
        console.error(`✗ --duration must be 15-600 seconds (got "${argv[i]}").`);
        process.exit(1);
      }
      durationSeconds = value;
    } else if (arg === "--niche") {
      const value = argv[i + 1] ?? "";
      i += 1;
      if (!(value in NICHE_PROFILES)) {
        console.error(`✗ Unknown --niche "${value}". Valid: ${Object.keys(NICHE_PROFILES).join(", ")}`);
        process.exit(1);
      }
      niche = value as PresetNiche;
    } else if (arg.startsWith("--")) {
      console.error(`✗ Unknown flag "${arg}". Flags: --niche <n>, --duration <sec>, --title, --dry`);
      process.exit(1);
    } else {
      positionals.push(arg);
    }
  }

  const instructions = positionals.join(" ").trim();
  if (instructions === "") {
    console.error('✗ Give me instructions, e.g.: npm run studio:brief -- "a calm history video about Rome"');
    process.exit(1);
  }
  return { instructions, niche, durationSeconds, format, exactTitle, dry };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.dry && !(await isFfprobeAvailable())) {
    logger.warn("ffmpeg/ffprobe not found on PATH — cannot render. Try --dry.");
    return;
  }
  if (!process.env.OPENAI_API_KEY && !args.dry) {
    logger.warn("Set OPENAI_API_KEY (voice + images) — or use --dry to preview the identity.");
    return;
  }

  console.log(`\n▶ Brief: "${args.instructions}"`);
  console.log(
    `  identity: ${args.niche ?? "AI-designed (custom)"} · format: ${args.format ?? "narrated-short"} · duration: ${args.durationSeconds ?? 65}s` +
      `${args.exactTitle ? " · exact title" : ""}${args.dry ? " · DRY RUN" : ""}\n`,
  );

  const resolved = await resolveBrief({
    instructions: args.instructions,
    ...(args.niche !== undefined ? { niche: args.niche } : {}),
    ...(args.durationSeconds !== undefined ? { durationSeconds: args.durationSeconds } : {}),
    ...(args.format !== undefined ? { format: args.format } : {}),
    exactTitle: args.exactTitle,
  } satisfies ContentBrief);

  const p = resolved.profile;
  console.log("=== Resolved identity ===");
  console.log(`  Show:     ${p.label}  (${p.niche})`);
  console.log(`  Audience: ${p.audience}`);
  console.log(`  Tone:     ${p.tone}   Pacing: ${p.pacing}   Language: ${p.language}`);
  console.log(`  Voice:    ${p.voice} — "${p.voiceInstructions}"`);
  console.log(`  Look:     ${p.visualStyle}`);
  console.log(`  Colour:   ${p.colorMood}`);
  console.log(`  Music:    ${p.musicPreset} (${p.musicMood})`);
  console.log(`  Captions: ${p.captionFont}, ${p.captionPosition}, accent ${p.captionAccent}, karaoke ${p.captionKaraoke ? "on" : "off"}`);
  console.log(`  Themes:   ${p.topicThemes.join("; ")}`);
  for (const warning of resolved.warnings) {
    console.log(`  ! ${warning}`);
  }

  if (args.dry) {
    console.log("\n(dry run — no video produced. Re-run without --dry to make it.)");
    return;
  }

  const result = await runResolvedBrief(resolved, {});
  console.log(`\n=== DONE ===`);
  console.log(`Run:      ${result.runId}   cost $${result.costUsd.toFixed(2)}`);
  console.log(`Title:    ${result.topic.title}`);
  console.log(`Duration: ${result.durationSeconds}s   QA: ${result.qa.status.toUpperCase()} (${result.qa.passed ? "publishable" : "BLOCKED"})`);
  console.log(`🎬 ${result.videoPath}`);
  console.log(`📁 ${result.finalDir}`);
  if (result.warnings.length > 0) {
    console.log(`\n--- Warnings (${result.warnings.length}) ---`);
    for (const warning of result.warnings.slice(0, 15)) {
      console.log(` ! ${warning}`);
    }
  }
}

main().catch((error: unknown) => {
  logger.error("Brief run failed", { error: String(error) });
  process.exitCode = 1;
});
