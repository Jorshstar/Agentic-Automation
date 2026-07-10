import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { createClaudeAIKernel } from "../ai/index.js";
import { getNicheProfile, NICHE_PROFILES } from "../config/niche-profiles.js";
import type { NicheProfile } from "../config/niche-profiles.js";
import {
  DEFAULT_RUN_SETTINGS,
  buildResearchContext,
  buildContentPlanContext,
  buildNarrativeContext,
  buildImageGenerationContext,
  buildVoiceGenerationContext,
  buildCaptionContext,
  buildMusicGenerationContext,
  buildCompositionContext,
  buildQaContext,
  buildThumbnailContext,
  buildStockVideoContext,
} from "../config/niche-context.js";
import type { RunSettings } from "../config/niche-context.js";
import { claudeCostUsd, imagesCostUsd, ttsCostUsd, webSearchCostUsd } from "../config/pricing.js";
import { RunLedger, makeRunId } from "./run-ledger.js";
import { ClaudeTopicGenerationProvider } from "../providers/topic-generation/index.js";
import { createTopicHistoryStore, normalizeTitle, recentCountries, recentEras } from "./topic-history.js";
import { ClaudeResearchProvider } from "../providers/research/index.js";
import type { ResearchPackage } from "../providers/research/index.js";
import { ClaudeContentPlanningProvider } from "../providers/content-planning/index.js";
import { ClaudeNarrativeProvider } from "../providers/narrative/index.js";
import type { NarrativeScript } from "../providers/narrative/index.js";
import { OpenAIImageGenerationProvider } from "../providers/image-generation/index.js";
import type { AssetPlan } from "../providers/asset-planning/index.js";
import { OpenAIVoiceGenerationProvider } from "../providers/voice-generation/index.js";
import { SubtitleCaptionProvider } from "../providers/caption-generation/index.js";
import { FfmpegMusicProvider } from "../providers/music-generation/index.js";
import { FfmpegCompositionProvider } from "../providers/composition/index.js";
import { FfprobeQaProvider } from "../providers/quality-assurance/index.js";
import type { QaCheck } from "../providers/quality-assurance/index.js";
import { ClaudeSeoProvider } from "../providers/seo/index.js";
import type { SeoPack } from "../providers/seo/index.js";
import { ClaudePodcastScriptProvider } from "../providers/podcast-script/index.js";
import type { PodcastCastMember, PodcastTurn } from "../providers/podcast-script/index.js";
import type { GeneratedVoiceover, GeneratedVoiceSegment } from "../providers/voice-generation/index.js";
import type { GeneratedImage, GeneratedImages } from "../providers/image-generation/index.js";
import { PexelsPixabayStockVideoProvider } from "../providers/stock-video/index.js";
import { runFfmpeg } from "../lib/media.js";
import type { VideoFormat } from "./formats.js";
import { FfmpegThumbnailProvider } from "../providers/thumbnail-generation/index.js";
import type { Niche } from "../types/index.js";

/**
 * runStudio — the end-to-end pipeline. Given a niche (and optionally a topic), it
 * chains every stage using the niche-context builders, so one `niche` drives the
 * whole run, and exports a QA'd MP4 + manifest to output/final/.
 *
 *   topic → Research → ContentPlan → Narrative → [scene images] + Voice
 *         → Captions → Music → Composition → QA → SEO → Thumbnails → Export
 *
 * HARDENED (Phase 1):
 *   - Every run is ISOLATED under output/runs/<runId>/ (no shared work dirs).
 *   - Every stage is CHECKPOINTED via the RunLedger — re-running with
 *     `resumeRunId` skips completed stages and loads their outputs, so a crash
 *     never re-pays for finished work (images, narration, ...).
 *   - Every AI stage's REAL COST is recorded per stage + totalled per run.
 *   - A stage failure throws StudioStageError (runId + stage) for alerting.
 *
 * This is the ONLY orchestration layer — a single sequential runner over the
 * existing providers. No new framework/kernel.
 */

export interface StudioRunOptions {
  readonly niche: Niche;
  /** Production format (default "narrated-short"). */
  readonly format?: VideoFormat;
  /** Explicit topic; when omitted, one is auto-generated for the niche. */
  readonly topic?: string;
  /** Resume a previous run by id — completed stages load from checkpoints. */
  readonly resumeRunId?: string;
  readonly run?: RunSettings;
  /**
   * Resolved creative identity (from a ContentBrief). When set it OVERRIDES the
   * niche's stored profile — this is how "custom" one-off identities run.
   */
  readonly profile?: NicheProfile;
  /** Plain-words directive the topic MUST fulfil (from a ContentBrief). */
  readonly instructions?: string;
  /** Pre-generated run id (briefs create it early to persist brief.json). */
  readonly runId?: string;
  /** Progress callback (defaults to console.log). */
  readonly onStep?: (message: string) => void;
}

export interface StudioResult {
  readonly runId: string;
  readonly niche: Niche;
  readonly topic: { readonly title: string; readonly angle: string; readonly hook: string };
  readonly keywords: readonly string[];
  readonly videoPath: string;
  readonly finalDir: string;
  readonly manifestPath: string;
  readonly durationSeconds: number;
  readonly segmentCount: number;
  readonly imagesGenerated: number;
  readonly qa: { readonly status: string; readonly passed: boolean; readonly checks: readonly QaCheck[] };
  /** Platform-ready upload metadata (YouTube + TikTok). */
  readonly seo: SeoPack;
  /** Ready-to-paste upload text file in the final package. */
  readonly uploadKitPath: string;
  /** Vertical cover in the final package ("" if none). */
  readonly thumbnailPath: string;
  /** 16:9 YouTube cover in the final package ("" if none). */
  readonly wideThumbnailPath: string;
  /** Lifetime cost of this run in USD (all sessions, all stages). */
  readonly costUsd: number;
  /** Stages loaded from checkpoints instead of re-run (empty on a fresh run). */
  readonly resumedStages: readonly string[];
  readonly warnings: readonly string[];
}

/** OpenAI TTS speaks ~2.3 words/sec at speed 1.0 (measured across the niche voices). */
const WORDS_PER_SEC = 2.3;

/**
 * Measured speaking rates by pacing. A single global rate was wrong: a slow,
 * ominous onyx delivery runs ~1.9 w/s, so a "157 word" script measured 83s and
 * had to be sped up 1.27x — destroying the very delivery the niche asked for.
 * Budget the words for the pace the voice will actually speak at.
 */
function wordsPerSecond(pacing: NicheProfile["pacing"]): number {
  switch (pacing) {
    case "slow":
      return 1.95;
    case "fast":
      return 2.55;
    case "medium":
    default:
      return WORDS_PER_SEC;
  }
}

/** Total words spoken across all narration segments. */
function countNarrationWords(narrative: NarrativeScript): number {
  return narrative.segments.reduce(
    (total, segment) => total + segment.text.trim().split(/\s+/u).filter((w) => w !== "").length,
    0,
  );
}

/** Checkpoint shapes for the composite stages. */
interface TopicCheckpoint {
  readonly title: string;
  readonly angle: string;
  readonly hook: string;
  readonly keywords: readonly string[];
  readonly costUsd: number;
}

interface NarrativeCheckpoint {
  readonly narrative: NarrativeScript;
  readonly words: number;
  readonly costUsd: number;
  /** Podcast format only: the two hosts + the dialogue turns. */
  readonly cast?: readonly PodcastCastMember[];
  readonly turns?: readonly PodcastTurn[];
}

interface ExportCheckpoint {
  readonly finalDir: string;
  readonly exportedVideo: string;
  readonly manifestPath: string;
  readonly uploadKitPath: string;
  readonly exportedThumb: string;
  readonly exportedThumbWide: string;
}

export async function runStudio(options: StudioRunOptions): Promise<StudioResult> {
  const log = options.onStep ?? ((m: string): void => console.log(m));
  const run = options.run ?? DEFAULT_RUN_SETTINGS;
  const kernel = createClaudeAIKernel();
  const warnings: string[] = [];

  // --- Run identity: fresh id, or resume an existing run's ledger ---
  const runId = options.resumeRunId ?? options.runId ?? makeRunId(options.niche);
  const ledger = await RunLedger.open(runId, options.niche);
  const niche: Niche =
    ledger.record.niche in NICHE_PROFILES || ledger.record.niche === "custom"
      ? (ledger.record.niche as Niche)
      : options.niche;
  // A brief-resolved profile wins; otherwise the niche's stored preset.
  const profile = options.profile ?? getNicheProfile(niche);
  const format: VideoFormat = options.format ?? "narrated-short";
  const runDir = ledger.runDir;
  log(`▶ Run ${runId}${format !== "narrated-short" ? ` · format: ${format}` : ""}${options.resumeRunId ? "  (resuming — completed stages will be skipped)" : ""}`);

  const history = createTopicHistoryStore();

  // Scary stories are HISTORICAL research: the researcher itself selects a real,
  // verifiable event (rotating country + era against memory), so the topic stage
  // is skipped and the chosen event's name becomes the topic.
  const historical = niche === "scary-stories";

  // --- 1. Topic (auto or explicit), with MEMORY so we never repeat ---
  const topicStage = await ledger.stage<TopicCheckpoint>(
    "topic",
    async () => {
      if (historical) {
        // The historical researcher picks the event in the next stage.
        return { title: "", angle: "", hook: "", keywords: [], costUsd: 0 };
      }
      if (options.topic) {
        return { title: options.topic, angle: "", hook: "", keywords: [], costUsd: 0 };
      }
      log("① Generating topic idea (avoiding past topics)...");
      const past = await history.recent(40);
      const avoidTopics = past.length > 0 ? past.map((t) => t.title).join("; ") : "none";
      const usedNormalized = new Set(past.map((t) => normalizeTitle(t.title)));
      const topicProvider = new ClaudeTopicGenerationProvider(kernel);
      const topicArgs = {
        niche: profile.label,
        audience: profile.audience,
        tone: profile.tone,
        themes: profile.topicThemes,
        avoidTopics,
        directive: options.instructions ?? "none",
      };

      // Regenerate if the model happens to return a title we've already used.
      let costUsd = 0;
      let generated = await topicProvider.generate(topicArgs);
      costUsd += claudeCostUsd(generated.metadata.tokenUsage);
      for (let attempt = 1; usedNormalized.has(normalizeTitle(generated.idea.title)) && attempt < 5; attempt += 1) {
        log(`   "${generated.idea.title}" was used before — regenerating (attempt ${attempt + 1}/5)...`);
        generated = await topicProvider.generate(topicArgs);
        costUsd += claudeCostUsd(generated.metadata.tokenUsage);
      }
      if (usedNormalized.has(normalizeTitle(generated.idea.title))) {
        warnings.push(`topic: no fresh topic after retries; using "${generated.idea.title}".`);
      }
      collect(warnings, generated.warnings.map((w) => `topic:${w.code}`));

      return {
        title: generated.idea.title || `A ${profile.label} short`,
        angle: generated.idea.angle,
        hook: generated.idea.hook,
        keywords: generated.idea.keywords,
        costUsd,
      };
    },
    (r) => r.costUsd,
  );
  if (!historical) {
    await ledger.setTopic(topicStage.title);
    log(`   Topic: "${topicStage.title}"`);
  }

  // --- 2. Research (LIVE web search — real, cited sources) ---
  const research = await ledger.stage(
    "research",
    async () => {
      const provider = new ClaudeResearchProvider(kernel, buildResearchContext(profile, run));

      if (historical) {
        log("① Researching a real historical event (picking + verifying it)...");
        const past = await history.recent(40);
        const result = await provider.research({
          topic: options.topic ?? options.instructions ?? "",
          historical: true,
          avoidTopics: past.map((t) => t.title),
          // HARD ROTATION: the last few countries/eras are forbidden outright.
          avoidCountries: recentCountries(past, 6),
          avoidEras: recentEras(past, 3),
        });
        const pkg = result.package;
        log(`   "${pkg?.eventName ?? "?"}" — ${pkg?.country ?? "?"}, ${pkg?.era ?? "?"} (${result.metadata.webSearchCount ?? 0} searches, ${result.references.length} sources).`);
        return result;
      }

      log("② Researching (searching the live web)...");
      const result = await provider.research({
        topic: topicStage.title,
        angle: topicStage.angle || undefined,
        keywords: topicStage.keywords,
      });
      log(`   ${result.metadata.webSearchCount ?? 0} searches, ${result.references.length} sources cited.`);
      return result;
    },
    (r) => claudeCostUsd(r.metadata.tokenUsage) + webSearchCostUsd(r.metadata.webSearchCount ?? 0),
  );
  collect(warnings, research.warnings.map((w) => `research: ${w}`));

  // For historical runs the event the researcher chose IS the topic. Its most
  // shocking verified fact becomes the hook the narrator opens on.
  const pkg = research.package;
  const title = historical ? pkg?.eventName || options.topic || "An unexplained historical event" : topicStage.title;
  const angle = historical ? (pkg?.whyDebated ?? "") : topicStage.angle;
  const hook = historical ? (pkg?.shockingFact ?? "") : topicStage.hook;
  const keywords = historical ? historicalKeywords(pkg) : topicStage.keywords;
  if (historical) {
    await ledger.setTopic(title);
  }

  // --- 3. Content plan ---
  const contentPlan = await ledger.stage(
    "content-plan",
    async () => {
      log("③ Planning content...");
      return new ClaudeContentPlanningProvider(kernel, buildContentPlanContext(profile, run)).plan({
        topic: title,
        // Historical runs carry the structured package forward as briefing text,
        // so the planner (and then the narrator) sees the shocking fact, the
        // official explanation, and exactly what remains unexplained.
        research: historical && pkg ? { ...research, summary: historicalBriefing(pkg) } : research,
      });
    },
    (r) => claudeCostUsd(r.metadata.tokenUsage),
  );
  collect(warnings, contentPlan.warnings.map((w) => `content-plan: ${w}`));

  // --- 4. Narrative — GATE ON WORD COUNT before spending on images/voice.
  //        Narration is a cheap Claude text call; images are the expensive part.
  //        So we retry the script until its word count fits the 60-70s window and
  //        ONLY THEN continue. If retries are exhausted, we use the closest attempt
  //        (and the voice step nudges speed as a last-resort safety net).
  const narrativeStage = await ledger.stage<NarrativeCheckpoint>(
    "narrative",
    async () => {
      // Derived from the run's target so ANY brief duration works (65s → 140-158
      // words; 90s → 198-215). Floor biased up so an undershoot still clears it.
      const wps = wordsPerSecond(profile.pacing);
      const wordsMin = Math.round((run.targetDurationSeconds - 4) * wps);
      const wordsMax = Math.round((run.targetDurationSeconds + 3.5) * wps);
      const targetWords = Math.round(run.targetDurationSeconds * wps);
      const maxNarrativeAttempts = 6;
      let costUsd = 0;

      // ---- PODCAST format: a two-host conversation instead of one narrator ----
      if (format === "podcast") {
        log("④ Writing podcast conversation (gating on word count)...");
        const writer = new ClaudePodcastScriptProvider(kernel);
        const request = {
          topic: title,
          research,
          tone: profile.tone,
          audience: profile.audience,
          language: profile.language,
          minWords: wordsMin,
          maxWords: wordsMax,
        };

        let script = await writer.write(request);
        costUsd += claudeCostUsd(script.metadata.tokenUsage);
        let best = script;
        for (
          let attempt = 1;
          (script.totalWords < wordsMin || script.totalWords > wordsMax) && attempt < maxNarrativeAttempts;
          attempt += 1
        ) {
          log(`   ${script.totalWords} words is outside ${wordsMin}-${wordsMax} — retrying script (attempt ${attempt + 1}/${maxNarrativeAttempts})...`);
          script = await writer.write(request);
          costUsd += claudeCostUsd(script.metadata.tokenUsage);
          if (Math.abs(script.totalWords - targetWords) < Math.abs(best.totalWords - targetWords)) {
            best = script;
          }
        }
        if (script.totalWords < wordsMin || script.totalWords > wordsMax) {
          script = best;
          warnings.push(`narrative: podcast word count ${script.totalWords} still outside window; using closest.`);
        }
        collect(warnings, script.warnings.map((w) => `podcast-script:${w.code} ${w.message}`));
        const [hostA, hostB] = script.cast;
        log(`   ✓ cast: ${hostA.name} (${hostA.voice}) + ${hostB.name} (${hostB.voice}) · ${script.turns.length} turns, ${script.totalWords} words.`);
        return {
          narrative: turnsToNarrative(script.turns, run.targetDurationSeconds),
          words: script.totalWords,
          costUsd,
          cast: script.cast,
          turns: script.turns,
        };
      }

      // ---- NARRATED-SHORT format (the original path) ----
      log("④ Writing narration (gating on word count)...");
      const narrator = new ClaudeNarrativeProvider(kernel, buildNarrativeContext(profile, run));

      let narrative = await narrator.narrate({ contentPlan });
      costUsd += claudeCostUsd(narrative.metadata.tokenUsage);
      let words = countNarrationWords(narrative);
      let bestNarrative = narrative;
      let bestWords = words;

      for (
        let attempt = 1;
        (words < wordsMin || words > wordsMax) && attempt < maxNarrativeAttempts;
        attempt += 1
      ) {
        log(`   ${words} words is outside ${wordsMin}-${wordsMax} — retrying narration (attempt ${attempt + 1}/${maxNarrativeAttempts})...`);
        narrative = await narrator.narrate({ contentPlan });
        costUsd += claudeCostUsd(narrative.metadata.tokenUsage);
        words = countNarrationWords(narrative);
        if (Math.abs(words - targetWords) < Math.abs(bestWords - targetWords)) {
          bestNarrative = narrative;
          bestWords = words;
        }
      }
      if (words < wordsMin || words > wordsMax) {
        narrative = bestNarrative;
        words = bestWords;
        warnings.push(
          `narrative: word count ${words} still outside ${wordsMin}-${wordsMax} after ${maxNarrativeAttempts} tries; using closest.`,
        );
      }
      collect(warnings, narrative.warnings.map((w) => `narrative: ${w}`));
      log(`   ✓ ${narrative.segments.length} scenes, ${words} words (target window ${wordsMin}-${wordsMax}).`);
      return { narrative, words, costUsd };
    },
    (r) => r.costUsd,
  );
  const { narrative, words } = narrativeStage;
  const cast = narrativeStage.cast ?? [];
  const turns = narrativeStage.turns ?? [];

  // --- 5. Scene images ---
  // narrated-short: one image per narration segment, grounded in each line.
  // podcast: FOUR studio "camera" shots (wide, host A, host B, topic insert),
  // then every turn is mapped to a shot — cutting to whoever is speaking, like
  // a real podcast edit, for a fraction of the image cost.
  const images = await ledger.stage(
    "images",
    async () => {
      const imageProvider = new OpenAIImageGenerationProvider({
        ...buildImageGenerationContext(profile, run),
        outputDir: `${runDir}/images`,
      });

      if (format === "podcast" && cast.length === 2 && turns.length > 0) {
        log("⑤ Generating 4 podcast camera shots (this is the slow part)...");
        const result = await imageProvider.generate({
          assetPlan: podcastShotPlan(cast as readonly [PodcastCastMember, PodcastCastMember], title, profile),
        });
        log(`   ${result.metadata.generated}/${result.metadata.requested} shots.`);
        return {
          ...result,
          images: mapTurnsToShots(turns, cast as readonly [PodcastCastMember, PodcastCastMember], result.images),
        };
      }

      // WATERFALL: try real stock footage per scene (Pexels → Pixabay), and only
      // pay for an AI image on the scenes stock couldn't cover. Real motion where
      // it fits, bespoke image where it doesn't — and cheaper than all-images.
      const plan = sceneImagePlan(narrative, profile);
      const stockBySegment = new Map<string, string>();
      if (run.useStockVideo) {
        log(`⑤ Sourcing real stock footage for ${narrative.segments.length} scenes...`);
        const stock = new PexelsPixabayStockVideoProvider({
          ...buildStockVideoContext(run),
          outputDir: `${runDir}/stock`,
        });
        for (const [i, segment] of narrative.segments.entries()) {
          const segmentId = `seg-${i + 1}`;
          const res = await stock.find({
            segmentId,
            // Prefer the AI's purpose-built generic stock keyword; fall back to
            // keyword-stripping the visual hint / narration for older scripts.
            query: segment.stockKeyword && segment.stockKeyword.trim() !== ""
              ? segment.stockKeyword
              : stockQueryForSegment(segment.visualHint, segment.text),
            neededSeconds: Math.max(2, Math.round(segment.endSecond - segment.startSecond)),
          });
          if (res.clip) {
            stockBySegment.set(segmentId, res.clip.clipPath);
          }
          // "no clip found" and "no key" are expected, not failures — only surface real errors.
          collect(
            warnings,
            res.warnings
              .filter((w) => w.code === "search-failed" || w.code === "download-failed")
              .map((w) => `stock:${w.code} ${w.message}`),
          );
        }
        log(`   ${stockBySegment.size}/${narrative.segments.length} scenes got real footage; ${narrative.segments.length - stockBySegment.size} need AI images.`);
      }

      // AI-generate only the scenes stock didn't cover.
      const uncovered: AssetPlan = {
        ...plan,
        segments: plan.segments.filter((s) => !stockBySegment.has(s.segmentId)),
      };
      let aiResult: GeneratedImages;
      if (uncovered.segments.length > 0) {
        const result = await imageProvider.generate({ assetPlan: uncovered });
        log(`   ${result.metadata.generated}/${result.metadata.requested} AI images.`);
        aiResult = result;
      } else {
        aiResult = emptyImages(`${runDir}/images`);
      }

      return mergeSceneVisuals(narrative, stockBySegment, aiResult);
    },
    (r) => imagesCostUsd(r.metadata.generated),
  );
  collect(warnings, images.warnings.map((w) => `image:${w.code} ${w.segmentId ?? ""}`));

  // --- 6. Voice (real narration; defines the master timeline) ---
  // MEASURE-THEN-CORRECT: synthesize at natural pace, measure the REAL duration
  // (per-voice speaking rates differ — echo ~2.5 wps vs onyx ~2.3, so estimates
  // lie), and if it misses the 60-70s window, re-synthesize ONCE at the exact
  // corrective speed (measured ÷ target). This is what actually holds the floor.
  const voiceover = await ledger.stage(
    "voice",
    async () => {
      const measuredFloor = run.targetDurationSeconds * 0.92;
      const measuredCeiling = run.targetDurationSeconds * 1.08;

      // ---- PODCAST: every turn in ITS host's voice, stitched on one timeline ----
      if (format === "podcast" && cast.length === 2 && turns.length > 0) {
        log(`⑥ Synthesizing ${turns.length} dialogue turns (two voices)...`);
        let result = await synthesizePodcast(turns, cast as readonly [PodcastCastMember, PodcastCastMember], profile, run, runDir, 1.0);
        log(`   ${result.totalDurationSeconds}s of conversation (natural pace).`);
        const measured = result.totalDurationSeconds;
        if (measured > 0 && (measured < measuredFloor || measured > measuredCeiling)) {
          const speed = Math.min(1.3, Math.max(0.75, measured / run.targetDurationSeconds));
          log(`   outside ${Math.round(measuredFloor)}-${Math.round(measuredCeiling)}s — re-synthesizing at speed ${speed.toFixed(3)}...`);
          result = await synthesizePodcast(turns, cast as readonly [PodcastCastMember, PodcastCastMember], profile, run, runDir, speed);
          log(`   ${result.totalDurationSeconds}s of conversation (corrected).`);
        }
        return result;
      }

      // ---- NARRATED-SHORT: single narrator (the original path) ----
      log("⑥ Synthesizing narration audio...");
      const voiceProvider = new OpenAIVoiceGenerationProvider({
        ...buildVoiceGenerationContext(profile, run),
        outputDir: `${runDir}/voice`,
      });

      let result = await voiceProvider.generate({ narrative });
      log(`   ${result.totalDurationSeconds}s of narration (natural pace).`);

      const measured = result.totalDurationSeconds;
      if (measured > 0 && (measured < measuredFloor || measured > measuredCeiling)) {
        const speed = Math.min(1.3, Math.max(0.75, measured / run.targetDurationSeconds));
        log(`   outside ${Math.round(measuredFloor)}-${Math.round(measuredCeiling)}s — re-synthesizing at speed ${speed.toFixed(3)} to hit ~${run.targetDurationSeconds}s...`);
        result = await voiceProvider.generate({ narrative, context: { speed } });
        log(`   ${result.totalDurationSeconds}s of narration (corrected).`);
      }
      return result;
    },
    (r) => ttsCostUsd(r.totalDurationSeconds),
  );
  collect(warnings, voiceover.warnings.map((w) => `voice:${w.code} ${w.segmentId ?? ""}`));

  // --- 7. Captions ---
  const captions = await ledger.stage("captions", async () => {
    log("⑦ Building captions...");
    return new SubtitleCaptionProvider({
      ...buildCaptionContext(profile, run),
      outputDir: `${runDir}/captions`,
      // Podcast captions carry "Name:" speaker labels — karaoke would recolour
      // the labels too, so dialogue uses plain sentence cues.
      ...(format === "podcast" ? { karaoke: false } : {}),
    }).generate({ voiceover });
  });

  // --- 8. Music (seeded variation: same mood, different key/feel every run) ---
  const music = await ledger.stage("music", async () => {
    log("⑧ Synthesizing music bed...");
    const result = await new FfmpegMusicProvider({
      ...buildMusicGenerationContext(profile, run),
      outputDir: `${runDir}/music`,
    }).generate({
      durationSeconds: voiceover.totalDurationSeconds,
      variationSeed: Math.floor(Math.random() * 2_147_483_647),
    });
    log(`   mood=${result.mood}, variation ${result.metadata.variation.semitones >= 0 ? "+" : ""}${result.metadata.variation.semitones} semitones.`);
    return result;
  });
  collect(warnings, music.warnings.map((w) => `music:${w.code}`));

  // --- 9. Composition ---
  const video = await ledger.stage("compose", async () => {
    log("⑨ Composing the video (FFmpeg)...");
    return new FfmpegCompositionProvider({
      ...buildCompositionContext(profile, run),
      outputPath: `${runDir}/video.mp4`,
      workDir: `${runDir}/video-work`,
    }).compose({ voiceover, images, captions, music });
  });
  collect(warnings, video.warnings.map((w) => `compose:${w.code} ${w.segmentId ?? ""}`));

  // --- 10. QA ---
  const qa = await ledger.stage("qa", async () => {
    log("⑩ Running QA...");
    const report = await new FfprobeQaProvider(buildQaContext(run, voiceover.totalDurationSeconds)).review({
      videoPath: video.videoPath,
    });
    log(`   QA: ${report.status.toUpperCase()} (${report.metadata.errorCount} error(s), ${report.metadata.warningCount} warning(s)).`);
    return report;
  });

  // --- 11. SEO upload kit (YouTube + TikTok metadata; cheap text call) ---
  const script = narrative.segments.map((s) => s.text).join(" ");
  const seo = await ledger.stage(
    "seo",
    async () => {
      log("⑪ Writing SEO upload pack...");
      const pack = await new ClaudeSeoProvider(kernel).generate({
        topic: title,
        hook,
        script,
        niche: profile.label,
        tone: profile.tone,
        audience: profile.audience,
        keywords,
        durationSeconds: video.durationSeconds,
        platform: run.platformLabel,
      });
      log(`   YT: "${pack.youtube.title}"`);
      return pack;
    },
    (r) => claudeCostUsd(r.metadata.tokenUsage),
  );
  collect(warnings, seo.warnings.map((w) => `seo:${w.code} ${w.message}`));

  // --- 12. Thumbnail covers (hook-scene image + SEO cover text; local, free) ---
  const thumbs = await ledger.stage("thumbnail", async () => {
    log("⑫ Rendering thumbnail covers...");
    // Prefer a real still image; if every scene is stock footage, grab a frame
    // from the first clip so the cover still has a real background.
    let hookImage =
      images.images.find((im) => im.status === "generated" && im.imagePath !== "")?.imagePath ?? "";
    if (hookImage === "") {
      const hookClip = images.images.find((im) => (im.videoPath ?? "") !== "")?.videoPath;
      if (hookClip) {
        const framePath = `${runDir}/thumbnails/hook-frame.jpg`;
        const grab = await runFfmpeg(["-y", "-ss", "1", "-i", hookClip, "-frames:v", "1", "-q:v", "3", framePath]);
        if (grab.ok) {
          hookImage = framePath;
        }
      }
    }
    const result = await new FfmpegThumbnailProvider({
      ...buildThumbnailContext(profile, run),
      outputDir: `${runDir}/thumbnails`,
    }).generate({ imagePath: hookImage, text: seo.thumbnailText });
    if (result.thumbnailPath !== "") {
      log(`   "${result.text}" burned onto the hook scene (vertical + wide).`);
    }
    return result;
  });
  collect(warnings, thumbs.warnings.map((w) => `thumbnail:${w.code} ${w.message}`));

  // --- 13. Export (package the final MP4 + captions + manifest + upload kit) ---
  const exported = await ledger.stage<ExportCheckpoint>("export", async () => {
    log("⑬ Exporting package...");
    const finalDir = join("output", "final", runId).replace(/\\/gu, "/");
    await mkdir(finalDir, { recursive: true });

    let exportedVideo = "";
    if (video.videoPath !== "") {
      exportedVideo = join(finalDir, "video.mp4").replace(/\\/gu, "/");
      await copyFile(video.videoPath, exportedVideo);
    }
    if (captions.srtPath !== "") {
      await copyFile(captions.srtPath, join(finalDir, basename(captions.srtPath)));
    }

    let exportedThumb = "";
    let exportedThumbWide = "";
    if (thumbs.thumbnailPath !== "") {
      exportedThumb = join(finalDir, "thumbnail.jpg").replace(/\\/gu, "/");
      await copyFile(thumbs.thumbnailPath, exportedThumb);
    }
    if (thumbs.wideThumbnailPath !== "") {
      exportedThumbWide = join(finalDir, "thumbnail-wide.jpg").replace(/\\/gu, "/");
      await copyFile(thumbs.wideThumbnailPath, exportedThumbWide);
    }

    const manifest = {
      runId,
      niche,
      title,
      angle,
      hook,
      keywords,
      script,
      seo: { youtube: seo.youtube, tiktok: seo.tiktok, thumbnailText: seo.thumbnailText },
      thumbnails: { vertical: exportedThumb, wide: exportedThumbWide },
      durationSeconds: video.durationSeconds,
      dimensions: `${video.width}x${video.height}`,
      costUsd: ledger.totalCostUsd(),
      scenes: voiceover.segments.map((s) => ({
        segmentId: s.segmentId,
        start: s.actualStartSecond,
        end: s.actualEndSecond,
        text: s.text,
        image: images.images.find((im) => im.segmentId === s.segmentId)?.imagePath ?? "",
      })),
      qa: { status: qa.status, passed: qa.passed, checks: qa.checks },
      warnings,
      createdAt: new Date().toISOString(),
    };
    const manifestPath = join(finalDir, "manifest.json").replace(/\\/gu, "/");
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

    // Ready-to-paste upload text — open, copy, post.
    const uploadKitPath = join(finalDir, "upload.txt").replace(/\\/gu, "/");
    await writeFile(uploadKitPath, renderUploadKit(seo), "utf8");

    return { finalDir, exportedVideo, manifestPath, uploadKitPath, exportedThumb, exportedThumbWide };
  });

  // --- 14. Remember this topic so future runs never repeat it. Checkpointed, so
  //         a resume never records the same topic twice. ---
  if (exported.exportedVideo !== "") {
    await ledger.stage("record-topic", async () => {
      // Country + era feed HARD ROTATION on the next historical run.
      await history.add({
        title,
        niche,
        date: new Date().toISOString().slice(0, 10),
        ...(pkg?.country ? { country: pkg.country } : {}),
        ...(pkg?.era ? { era: pkg.era } : {}),
      });
      return { recorded: true };
    });
  }

  await ledger.setStatus(qa.passed ? "completed" : "blocked", qa.passed ? undefined : "QA failed");
  log(`   Run cost: $${ledger.totalCostUsd().toFixed(2)}${ledger.resumedStages.length > 0 ? `  (resumed: ${ledger.resumedStages.join(", ")})` : ""}`);

  return {
    runId,
    niche,
    topic: { title, angle, hook },
    keywords,
    videoPath: exported.exportedVideo,
    finalDir: exported.finalDir,
    manifestPath: exported.manifestPath,
    durationSeconds: video.durationSeconds,
    segmentCount: narrative.segments.length,
    imagesGenerated: images.metadata.generated,
    qa: { status: qa.status, passed: qa.passed, checks: qa.checks },
    seo,
    uploadKitPath: exported.uploadKitPath,
    thumbnailPath: exported.exportedThumb,
    wideThumbnailPath: exported.exportedThumbWide,
    costUsd: ledger.totalCostUsd(),
    resumedStages: ledger.resumedStages,
    warnings,
  };
}

/** Render the copy-paste upload sheet written next to the video. */
function renderUploadKit(seo: SeoPack): string {
  const lines = [
    "==================================================",
    "YOUTUBE (Shorts)",
    "==================================================",
    "",
    "TITLE:",
    seo.youtube.title,
    "",
    "DESCRIPTION:",
    seo.youtube.description,
    "",
    seo.youtube.hashtags.join(" "),
    "",
    "TAGS (paste into the tags box):",
    seo.youtube.tags.join(", "),
    "",
    "==================================================",
    "TIKTOK",
    "==================================================",
    "",
    "CAPTION:",
    `${seo.tiktok.caption} ${seo.tiktok.hashtags.join(" ")}`,
    "",
  ];
  return lines.join("\n");
}

/** Build a per-scene image plan whose prompts are GROUNDED in the narration. */
function sceneImagePlan(narrative: NarrativeScript, profile: NicheProfile): AssetPlan {
  const segments = narrative.segments.map((segment, i) => ({
    segmentId: `seg-${i + 1}`,
    assetType: "ai-image" as const,
    primaryProvider: "openai-images" as const,
    fallbackProvider: "runway" as const,
    searchQueries: [] as string[],
    // The image must depict THIS scene: lead with the visual hint, ground it in
    // the exact narrated line, and enforce the niche's consistent look.
    visualPrompt:
      `${segment.visualHint || segment.text} — a cinematic vertical (9:16) still that depicts ` +
      `this exact moment: "${segment.text}". Art direction: ${profile.visualStyle}. ` +
      `Colour mood: ${profile.colorMood}. Atmospheric, dramatic lighting, photorealistic, ` +
      `highly detailed. Absolutely no text, letters, captions, or watermarks in the image.`,
    estimatedDuration: Math.max(1, Math.round(segment.endSecond - segment.startSecond)),
    licenseRequirements: "AI-generated",
    notes: segment.emotion,
  }));

  return {
    segments,
    warnings: [],
    metadata: {
      promptId: "runner",
      promptVersion: "v1",
      provider: "runner",
      model: "runner",
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      latencyMs: 0,
    },
  };
}

/**
 * Flatten the research package into a briefing the planner/narrator can read.
 * Keeps the evidence distinctions the researcher was careful to draw, so the
 * narrator can't quietly upgrade a theory into a fact.
 */
function historicalBriefing(pkg: ResearchPackage): string {
  const lines = [
    `EVENT: ${pkg.eventName} — ${pkg.location}, ${pkg.country} (${pkg.period})`,
    ``,
    `MOST SHOCKING VERIFIED FACT (open on this): ${pkg.shockingFact}`,
    ``,
    `BACKGROUND: ${pkg.background}`,
    ``,
    `TIMELINE:`,
    ...pkg.timeline.map((t) => `- ${t.when}: ${t.what}`),
    ``,
    `OFFICIAL EXPLANATION: ${pkg.officialExplanation}`,
    ``,
    `ALTERNATIVE THEORIES:`,
    ...pkg.alternativeTheories.map((t) => `- ${t.theory} (${t.proponents}) — evidence: ${t.evidence}`),
    ``,
    `WHY EXPERTS STILL DEBATE IT: ${pkg.whyDebated}`,
    ``,
    `STILL UNEXPLAINED:`,
    ...pkg.unexplainedFacts.map((f) => `- ${f}`),
    ``,
    `EVIDENCE GRADING (do NOT state a low-confidence claim as fact):`,
    ...pkg.claims.map((c) => `- [${c.type}, confidence ${c.confidence}] ${c.claim}`),
  ];
  return lines.join("\n");
}

/** SEO/stock keywords for a historical run: place, era, and the people involved. */
function historicalKeywords(pkg: ResearchPackage | undefined): readonly string[] {
  if (!pkg) {
    return [];
  }
  return [pkg.country, pkg.era.replace(/-/gu, " "), ...pkg.peopleInvolved.slice(0, 2)]
    .map((k) => k.trim())
    .filter((k) => k !== "" && k.toLowerCase() !== "unknown");
}

/* ------------------------------ stock-video helpers ------------------------------ */

/** A short, keyword-y search phrase for a scene (stock search wants keywords,
 *  not full sentences). Prefer the visual hint; fall back to the first words of
 *  the narration, stripped of filler. */
function stockQueryForSegment(visualHint: string, text: string): string {
  const base = (visualHint && visualHint.trim() !== "" ? visualHint : text).toLowerCase();
  const words = base
    .replace(/[^a-z0-9\s]/gu, " ")
    .split(/\s+/u)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  return words.slice(0, 5).join(" ").trim() || base.split(/\s+/u).slice(0, 4).join(" ");
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "was", "were", "are", "his", "her", "she",
  "him", "they", "them", "you", "your", "but", "not", "had", "has", "have", "from", "into",
  "our", "out", "over", "then", "than", "when", "what", "who", "how", "why", "its", "it's",
]);

/** An empty GeneratedImages shell (used when stock covered every scene). */
function emptyImages(outputDir: string): GeneratedImages {
  return {
    images: [],
    outputDir,
    warnings: [],
    metadata: {
      provider: "openai", model: "gpt-image-1", size: "", quality: "",
      requested: 0, generated: 0, totalBytes: 0, latencyMs: 0,
    },
  };
}

/** Merge the stock clips and AI images into one per-scene visual list: each
 *  segment carries a `videoPath` (stock won) OR an `imagePath` (AI). */
function mergeSceneVisuals(
  narrative: NarrativeScript,
  stockBySegment: ReadonlyMap<string, string>,
  aiResult: GeneratedImages,
): GeneratedImages {
  const aiById = new Map(aiResult.images.map((im) => [im.segmentId, im]));
  const images: GeneratedImage[] = narrative.segments.map((_, i) => {
    const segmentId = `seg-${i + 1}`;
    const clipPath = stockBySegment.get(segmentId);
    if (clipPath) {
      return {
        segmentId, prompt: "stock-footage", imagePath: "", videoPath: clipPath,
        status: "generated", model: "stock", format: "jpeg", width: 0, height: 0, bytes: 0,
      };
    }
    const ai = aiById.get(segmentId);
    if (ai) {
      return ai;
    }
    return {
      segmentId, prompt: "", imagePath: "", status: "failed",
      model: "none", format: "jpeg", width: 0, height: 0, bytes: 0,
    };
  });
  return { ...aiResult, images };
}

/* ------------------------------ podcast helpers ------------------------------ */

/** Map dialogue turns onto the shared timeline (proportional to word share). */
function turnsToNarrative(turns: readonly PodcastTurn[], targetSeconds: number): NarrativeScript {
  const weights = turns.map((turn) => Math.max(turn.text.trim().split(/\s+/u).length, 1));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = 0;
  const segments = turns.map((turn, i) => {
    const share = ((weights[i] ?? 1) / totalWeight) * targetSeconds;
    const segment = {
      startSecond: Math.round(cursor * 100) / 100,
      endSecond: Math.round((cursor + share) * 100) / 100,
      text: turn.text,
      emotion: turn.emotion,
      visualHint: "",
      stockKeyword: "",
    };
    cursor += share;
    return segment;
  });
  return {
    hook: turns[0]?.text ?? "",
    segments,
    callToAction: turns[turns.length - 1]?.text ?? "",
    estimatedDurationSeconds: targetSeconds,
    warnings: [],
    metadata: {
      promptId: "podcast-script.user",
      promptVersion: "v1",
      provider: "claude",
      model: "claude-opus-4-8",
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      latencyMs: 0,
    },
  };
}

/** The four podcast "camera" shots: wide, host A close, host B close, insert. */
function podcastShotPlan(
  cast: readonly [PodcastCastMember, PodcastCastMember],
  topic: string,
  profile: NicheProfile,
): AssetPlan {
  const style =
    `${profile.visualStyle}. Colour mood: ${profile.colorMood}. Warm podcast-studio lighting, ` +
    `professional microphones and headphones, vertical 9:16, photorealistic, no text or captions.`;
  const prompts = [
    `Wide shot of a cozy podcast studio: two hosts at a table with microphones — ${cast[0].persona} on the left, ${cast[1].persona} on the right, mid-conversation. ${style}`,
    `Close-up of a podcast host speaking into a microphone: ${cast[0].persona}, animated mid-sentence, headphones on. ${style}`,
    `Close-up of a podcast host speaking into a microphone: ${cast[1].persona}, reacting thoughtfully, headphones on. ${style}`,
    `Atmospheric illustrative b-roll about "${topic}" — evocative, cinematic, matching the show's look. ${style}`,
  ];
  return {
    segments: prompts.map((visualPrompt, i) => ({
      segmentId: `shot-${i + 1}`,
      assetType: "ai-image" as const,
      primaryProvider: "openai-images" as const,
      fallbackProvider: "runway" as const,
      searchQueries: [] as string[],
      visualPrompt,
      estimatedDuration: 0,
      licenseRequirements: "AI-generated",
      notes: ["studio wide", "host A", "host B", "topic insert"][i] ?? "",
    })),
    warnings: [],
    metadata: {
      promptId: "podcast-shots",
      promptVersion: "v1",
      provider: "runner",
      model: "runner",
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      latencyMs: 0,
    },
  };
}

/**
 * Cut every turn to a camera shot like a real podcast edit: open and close on
 * the wide, cut to whoever is speaking, and drop in the topic insert every few
 * turns for variety. Missing shots fall back to the wide (never a black card).
 */
function mapTurnsToShots(
  turns: readonly PodcastTurn[],
  cast: readonly [PodcastCastMember, PodcastCastMember],
  shots: readonly GeneratedImage[],
): readonly GeneratedImage[] {
  const byShot = new Map(shots.filter((s) => s.status === "generated" && s.imagePath !== "").map((s) => [s.segmentId, s]));
  const wide = byShot.get("shot-1") ?? [...byShot.values()][0];
  const pick = (turn: PodcastTurn, index: number): GeneratedImage | undefined => {
    if (index === 0 || index === turns.length - 1) {
      return wide;
    }
    if (index % 5 === 3) {
      return byShot.get("shot-4") ?? wide;
    }
    return (turn.speaker === cast[0].name ? byShot.get("shot-2") : byShot.get("shot-3")) ?? wide;
  };
  const mapped: GeneratedImage[] = [];
  turns.forEach((turn, index) => {
    const shot = pick(turn, index);
    if (shot) {
      mapped.push({ ...shot, segmentId: `seg-${index + 1}` });
    }
  });
  return mapped;
}

/** Synthesize every dialogue turn in its host's voice; stitch one measured timeline. */
async function synthesizePodcast(
  turns: readonly PodcastTurn[],
  cast: readonly [PodcastCastMember, PodcastCastMember],
  profile: NicheProfile,
  run: RunSettings,
  runDir: string,
  speed: number,
): Promise<GeneratedVoiceover> {
  const byName = new Map(cast.map((member) => [member.name, member]));
  const segments: GeneratedVoiceSegment[] = [];
  const startedAt = Date.now();
  let cursor = 0;
  let totalCharacters = 0;

  for (const [index, turn] of turns.entries()) {
    const member = byName.get(turn.speaker) ?? cast[index % 2] ?? cast[0];
    const provider = new OpenAIVoiceGenerationProvider({
      ...buildVoiceGenerationContext(profile, run),
      voice: member.voice,
      instructions: member.voiceInstructions,
      speed,
      outputDir: `${runDir}/voice/turn-${String(index + 1).padStart(2, "0")}`,
    });
    const single = await provider.generate({
      narrative: turnsToNarrative([turn], Math.max(2, turn.text.length / 15)),
    });
    const spoken = single.segments[0];
    if (!spoken) {
      continue; // synthesis warning already recorded by the provider result
    }
    segments.push({
      ...spoken,
      segmentId: `seg-${index + 1}`,
      // Speaker label shows in the burned captions, movie-dialogue style.
      text: `${member.name}: ${turn.text}`,
      voice: member.voice,
      actualStartSecond: Math.round(cursor * 100) / 100,
      actualEndSecond: Math.round((cursor + spoken.actualDurationSeconds) * 100) / 100,
    });
    cursor += spoken.actualDurationSeconds;
    totalCharacters += turn.text.length;
  }

  return {
    segments,
    totalDurationSeconds: Math.round(cursor * 100) / 100,
    outputDir: `${runDir}/voice`,
    warnings: segments.length === turns.length ? [] : [{ code: "synthesis-failed", message: `${turns.length - segments.length} turn(s) failed to synthesize.` }],
    metadata: {
      provider: "openai",
      model: run.voiceModel,
      voice: `${cast[0].voice}+${cast[1].voice}`,
      format: run.voiceFormat,
      segmentCount: segments.length,
      totalCharacters,
      latencyMs: Date.now() - startedAt,
    },
  };
}

function collect(target: string[], items: readonly string[]): void {
  for (const item of items) {
    target.push(item);
  }
}
