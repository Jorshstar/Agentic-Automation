import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createClaudeAIKernel } from "../ai/index.js";
import type { AIKernel } from "../ai/index.js";
import { getNicheProfile } from "../config/niche-profiles.js";
import type { NicheProfile } from "../config/niche-profiles.js";
import { DEFAULT_RUN_SETTINGS } from "../config/niche-context.js";
import type { RunSettings } from "../config/niche-context.js";
import { ClaudeIdentityDesignProvider } from "../providers/identity-design/index.js";
import { runStudio, type StudioResult } from "./run-studio.js";
import { makeRunId } from "./run-ledger.js";
import type { VideoFormat } from "./formats.js";
import type { PresetNiche } from "../types/index.js";

/**
 * The Brief Engine — command the studio in plain words.
 *
 * A ContentBrief says WHAT to make ("a calm 90-second bedtime history video
 * about the fall of Rome"), and the engine turns it into a fully-resolved run:
 *   - identity: a preset niche, a preset + overrides, or (with no niche) a
 *     ONE-OFF identity designed by AI from the instructions,
 *   - duration: any target — every downstream window (word budget, voice
 *     correction, QA bounds) derives from it,
 *   - the same hardened pipeline: ledger, checkpoints, resume, QA, delivery.
 *
 * The resolved brief is persisted to output/runs/<runId>/brief.json so custom
 * runs resume with EXACTLY the same identity (no re-design, no drift).
 */

export interface ContentBrief {
  /** What to make, in plain words. Drives the topic (and the identity when no niche is given). */
  readonly instructions: string;
  /** Production format (default "narrated-short"). */
  readonly format?: VideoFormat;
  /** Base the identity on a preset niche; omit to have AI design a one-off identity. */
  readonly niche?: PresetNiche;
  /** One-off tweaks applied on top of the base identity (voice, tone, style, ...). */
  readonly identity?: Partial<Omit<NicheProfile, "niche">>;
  /** Target length in seconds (default 65). All duration windows derive from it. */
  readonly durationSeconds?: number;
  /** Use the instructions verbatim as the title instead of generating a topic. */
  readonly exactTitle?: boolean;
}

/** A brief after identity + settings resolution — everything a run needs. */
export interface ResolvedBrief {
  readonly format: VideoFormat;
  readonly profile: NicheProfile;
  readonly run: RunSettings;
  readonly instructions: string;
  readonly exactTitle: boolean;
  /** Non-fatal notes from identity design (fallbacks applied, etc.). */
  readonly warnings: readonly string[];
}

/**
 * Resolve a brief into a runnable identity + settings. Only calls AI when no
 * preset niche is given (the identity designer, ~1¢); preset briefs are free.
 */
export async function resolveBrief(brief: ContentBrief, kernel?: AIKernel): Promise<ResolvedBrief> {
  const warnings: string[] = [];

  let base: NicheProfile;
  if (brief.niche !== undefined) {
    base = getNicheProfile(brief.niche);
  } else {
    const designer = new ClaudeIdentityDesignProvider(kernel ?? createClaudeAIKernel());
    const designed = await designer.design({ instructions: brief.instructions });
    base = designed.profile;
    for (const warning of designed.warnings) {
      warnings.push(`identity:${warning.code} ${warning.message}`);
    }
  }

  // Apply one-off overrides (only the fields actually provided).
  const overrides = Object.fromEntries(
    Object.entries(brief.identity ?? {}).filter(([, value]) => value !== undefined),
  ) as Partial<NicheProfile>;
  const profile: NicheProfile = { ...base, ...overrides, niche: base.niche };

  const run: RunSettings = {
    ...DEFAULT_RUN_SETTINGS,
    targetDurationSeconds: brief.durationSeconds ?? DEFAULT_RUN_SETTINGS.targetDurationSeconds,
  };

  return {
    format: brief.format ?? "narrated-short",
    profile,
    run,
    instructions: brief.instructions,
    exactTitle: brief.exactTitle ?? false,
    warnings,
  };
}

/* ------------------------- persistence (for resume) ------------------------- */

function briefPath(runId: string): string {
  return join("output", "runs", runId, "brief.json");
}

export async function saveResolvedBrief(runId: string, resolved: ResolvedBrief): Promise<void> {
  await mkdir(join("output", "runs", runId), { recursive: true });
  await writeFile(briefPath(runId), JSON.stringify(resolved, null, 2), "utf8");
}

/** Load a run's persisted brief, or undefined if it has none (preset runs). */
export async function loadResolvedBrief(runId: string): Promise<ResolvedBrief | undefined> {
  try {
    const parsed = JSON.parse(await readFile(briefPath(runId), "utf8")) as ResolvedBrief;
    // Briefs saved before the format registry existed default to narrated-short.
    return { ...parsed, format: parsed.format ?? "narrated-short" };
  } catch {
    return undefined;
  }
}

/* --------------------------------- running --------------------------------- */

export interface RunBriefOptions {
  readonly resumeRunId?: string;
  readonly onStep?: (message: string) => void;
}

/** Resolve and run a brief end-to-end (the plain-words entry point). */
export async function runBrief(brief: ContentBrief, options: RunBriefOptions = {}): Promise<StudioResult> {
  const resolved = await resolveBrief(brief);
  return runResolvedBrief(resolved, options);
}

/**
 * Start a brief and return its runId IMMEDIATELY (the run continues in the
 * background via `done`). Used by the dashboard so the UI can begin following
 * the ledger while the pipeline works. Callers must attach a .catch to `done`.
 */
export async function startBrief(
  brief: ContentBrief,
  options: RunBriefOptions = {},
): Promise<{ runId: string; done: Promise<StudioResult> }> {
  const resolved = await resolveBrief(brief);
  const runId = makeRunId(resolved.profile.niche);
  await saveResolvedBrief(runId, resolved);
  const done = runStudio({
    niche: resolved.profile.niche,
    format: resolved.format,
    profile: resolved.profile,
    run: resolved.run,
    instructions: resolved.instructions,
    ...(resolved.exactTitle ? { topic: resolved.instructions } : {}),
    runId,
    ...(options.onStep ? { onStep: options.onStep } : {}),
  });
  return { runId, done };
}

/** Run an already-resolved brief (used by resume, dry-run previews, tests). */
export async function runResolvedBrief(
  resolved: ResolvedBrief,
  options: RunBriefOptions = {},
): Promise<StudioResult> {
  const runId = options.resumeRunId ?? makeRunId(resolved.profile.niche);
  await saveResolvedBrief(runId, resolved);

  return runStudio({
    niche: resolved.profile.niche,
    format: resolved.format,
    profile: resolved.profile,
    run: resolved.run,
    instructions: resolved.instructions,
    ...(resolved.exactTitle ? { topic: resolved.instructions } : {}),
    ...(options.resumeRunId ? { resumeRunId: options.resumeRunId } : { runId }),
    ...(options.onStep ? { onStep: options.onStep } : {}),
  });
}
