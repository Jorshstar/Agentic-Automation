import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { runFfmpeg, probeDurationSeconds } from "../../lib/media.js";
import type { MusicGenerationProvider } from "./music-generation-provider.js";
import type {
  MusicMood,
  MusicGenerationContext,
  MusicGenerationRequest,
  GeneratedMusic,
  MusicGenerationWarning,
  MusicGenerationMetadata,
} from "./types.js";

/**
 * FfmpegMusicProvider — synthesizes a simple ambient bed with FFmpeg oscillators.
 *
 * Fully local: no AI, no network, no key. Each mood is a small filtergraph of sine
 * drones (+ optional noise) shaped by tremolo/filters, sized to the requested
 * length with a fade in/out. It is intentionally SIMPLE (an atmosphere, not a
 * produced track) — swap for a real music source later behind the same interface.
 * Defensive: a synthesis failure becomes a warning + empty path, not a crash, so
 * the video can still be composed without music.
 */

const DEFAULT_MUSIC_CONTEXT: MusicGenerationContext = {
  mood: "neutral",
  format: "mp3",
  // 1.0 = full level after loudnorm; Composition ducks the bed under the voice.
  volume: 1.0,
  fadeSeconds: 1.5,
  sampleRate: 44_100,
  outputDir: "output/music",
};

/** Per-mood synthesis recipe (tremolo split out so variation can jitter it). */
interface MoodSpec {
  readonly sines: readonly number[];
  readonly noise?: { readonly color: string; readonly amplitude: number };
  /** Optional amix input weights (space-separated), one per input (sines + noise). */
  readonly weights?: string;
  /** Slow amplitude wobble (rate Hz, depth 0..1). */
  readonly tremolo?: { readonly f: number; readonly d: number };
  /** EQ filters applied after tremolo (comma-separated). */
  readonly eq: string;
}

function moodSpec(mood: MusicMood): MoodSpec {
  switch (mood) {
    case "tense-drone":
      // Deep A/E power-chord stack (ominous) PLUS present mid octaves (E3/A3/E4)
      // so the drone reads clearly on small laptop speakers, not just subwoofers.
      return {
        sines: [55, 82.41, 110, 164.81, 220, 329.63],
        noise: { color: "brown", amplitude: 0.05 },
        weights: "0.9 0.8 0.8 0.75 0.8 0.55 0.35",
        tremolo: { f: 0.14, d: 0.6 },
        eq: "highpass=f=40,lowpass=f=2200",
      };
    case "upbeat-electronic":
      return {
        sines: [130.81, 261.63, 329.63, 392.0],
        tremolo: { f: 3.6, d: 0.6 },
        eq: "highpass=f=100,lowpass=f=6000",
      };
    case "warm-pad":
      return {
        sines: [196.0, 261.63, 329.63, 392.0],
        tremolo: { f: 0.25, d: 0.25 },
        eq: "lowpass=f=2600",
      };
    case "emotive-score":
      return {
        sines: [110, 220, 261.63, 329.63],
        tremolo: { f: 0.18, d: 0.4 },
        eq: "lowpass=f=3200",
      };
    case "neutral":
    default:
      return { sines: [220, 329.63], eq: "lowpass=f=3000" };
  }
}

/* ------------------------------ seeded variation ----------------------------- */

/** The applied variation (what actually changed vs. the base recipe). */
interface AppliedVariation {
  readonly seed: number;
  readonly semitones: number;
  readonly tremoloFactor: number;
  readonly noiseFactor: number;
}

/** Tiny deterministic PRNG (mulberry32) — same seed, same bed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Derive this run's variation from the seed: transpose the whole stack by a
 * musical interval (-3..+3 semitones — mood preserved, key changes) and jitter
 * the tremolo rate and noise level slightly. No two seeds sound identical.
 */
function deriveVariation(seed: number): AppliedVariation {
  const rand = mulberry32(seed);
  return {
    seed,
    semitones: Math.floor(rand() * 7) - 3, // -3..+3
    tremoloFactor: round3(0.8 + rand() * 0.5), // ×0.8..×1.3
    noiseFactor: round3(0.8 + rand() * 0.4), // ×0.8..×1.2
  };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export class FfmpegMusicProvider implements MusicGenerationProvider {
  readonly name = "ffmpeg-music-provider";

  private lastResult: GeneratedMusic | undefined;

  constructor(private readonly context: MusicGenerationContext = DEFAULT_MUSIC_CONTEXT) {}

  /** The most recent track produced (handy for demos/telemetry). */
  get last(): GeneratedMusic | undefined {
    return this.lastResult;
  }

  async generate(request: MusicGenerationRequest): Promise<GeneratedMusic> {
    const context: MusicGenerationContext = { ...this.context, ...request.context };
    const warnings: MusicGenerationWarning[] = [];
    const startedAt = Date.now();

    let duration = request.durationSeconds;
    if (!Number.isFinite(duration) || duration <= 0) {
      warnings.push({ code: "invalid-duration", message: `Invalid duration ${duration}; using 15s.` });
      duration = 15;
    }
    duration = Math.round(duration * 100) / 100;

    await mkdir(context.outputDir, { recursive: true });
    const musicPath = join(context.outputDir, `music.${context.format}`);

    const seed = request.variationSeed ?? Math.floor(Math.random() * 2_147_483_647);
    const variation = deriveVariation(seed);

    const args = buildFfmpegArgs(context, duration, variation, musicPath);
    const run = await runFfmpeg(args);

    let measured = 0;
    let bytes = 0;
    if (!run.ok) {
      warnings.push({ code: "synthesis-failed", message: `FFmpeg failed: ${run.stderr}` });
    } else {
      const probed = await probeDurationSeconds(musicPath);
      if (probed === undefined) {
        warnings.push({ code: "probe-failed", message: "Could not measure the generated track." });
        measured = duration;
      } else {
        measured = Math.round(probed * 100) / 100;
      }
      bytes = await fileBytes(musicPath);
    }

    const metadata: MusicGenerationMetadata = {
      provider: this.name,
      mood: context.mood,
      requestedDurationSeconds: duration,
      sampleRate: context.sampleRate,
      variation: {
        seed: variation.seed,
        semitones: variation.semitones,
        tremoloFactor: variation.tremoloFactor,
      },
      latencyMs: Date.now() - startedAt,
    };

    const result: GeneratedMusic = {
      musicPath: run.ok ? musicPath : "",
      mood: context.mood,
      durationSeconds: measured,
      format: context.format,
      bytes,
      warnings,
      metadata,
    };
    this.lastResult = result;
    return result;
  }
}

/** Build the ffmpeg args for a mood at a given duration, with variation applied. */
function buildFfmpegArgs(
  context: MusicGenerationContext,
  duration: number,
  variation: AppliedVariation,
  outputPath: string,
): string[] {
  const spec = moodSpec(context.mood);
  const sr = context.sampleRate;

  // Transpose the whole stack by the variation's interval (2^(semitones/12)).
  const transpose = Math.pow(2, variation.semitones / 12);
  const inputs: string[] = spec.sines.map(
    (freq) => `sine=frequency=${round3(freq * transpose)}:duration=${duration}:sample_rate=${sr}`,
  );
  if (spec.noise) {
    const amplitude = round3(spec.noise.amplitude * variation.noiseFactor);
    inputs.push(
      `anoisesrc=d=${duration}:color=${spec.noise.color}:amplitude=${amplitude}:sample_rate=${sr}`,
    );
  }

  const inputCount = inputs.length;
  const labels = inputs.map((_, i) => `[${i}:a]`).join("");

  // Keep fades sensible for short clips.
  const fade = Math.min(context.fadeSeconds, duration / 3);
  const fadeOutStart = Math.max(0, duration - fade);

  const tremolo = spec.tremolo
    ? `tremolo=f=${round3(spec.tremolo.f * variation.tremoloFactor)}:d=${spec.tremolo.d},`
    : "";

  // loudnorm brings the (very quiet) summed oscillators up to a consistent,
  // audible loudness — and makes every niche's bed equally loud. aresample fixes
  // loudnorm's internal rate change; the final volume is an optional trim.
  const weights = spec.weights ? `:weights=${spec.weights}` : "";
  const filter =
    `${labels}amix=inputs=${inputCount}:duration=longest${weights},` +
    `${tremolo}${spec.eq},loudnorm=I=-16:TP=-1.5:LRA=11,aresample=${sr},volume=${context.volume},` +
    `afade=t=in:st=0:d=${fade},afade=t=out:st=${fadeOutStart}:d=${fade}[a]`;

  const args: string[] = ["-y"];
  for (const input of inputs) {
    args.push("-f", "lavfi", "-i", input);
  }
  args.push("-filter_complex", filter, "-map", "[a]", "-ar", String(sr), "-ac", "2", "-t", String(duration));
  if (context.format === "mp3") {
    args.push("-c:a", "libmp3lame", "-b:a", "192k");
  } else {
    args.push("-c:a", "pcm_s16le");
  }
  args.push(outputPath);
  return args;
}

async function fileBytes(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}
