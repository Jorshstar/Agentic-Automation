import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveMediaTool } from "../lib/binaries.js";

const execFileAsync = promisify(execFile);

/**
 * AUDIO ENERGY ANALYSIS — the cheap signal that tells us "something happened
 * here" with no pixel analysis and no AI cost.
 *
 * It measures RMS loudness twice a second and then groups the loud stretches
 * into EVENTS, because the shape of a loud stretch tells you what kind of
 * moment it is:
 *
 *   - a SPIKE (< 1.5s) is a laugh, a gasp, a shout, an impact;
 *   - a SURGE (>= 1.5s sustained) is a crowd roar, applause, a chant — which in
 *     football is almost always a goal.
 *
 * The previous version returned a flat list of loud seconds with no duration or
 * prominence, so a brief door slam looked identical to a stadium erupting. That
 * made "clip the goals" unreliable. Events fix that.
 *
 * Never throws. On any failure every field comes back empty and the caller falls
 * back to the transcript alone.
 */

/** One loud second, kept for backward compatibility with the selector prompt. */
export interface EnergyPeak {
  readonly second: number;
  /** RMS level in dB (higher = louder; typically -60..0). */
  readonly db: number;
}

export type AudioEventKind = "spike" | "surge";

/** A grouped stretch of unusually loud audio. */
export interface AudioEvent {
  readonly startSecond: number;
  readonly endSecond: number;
  readonly durationSeconds: number;
  /** Loudest RMS reading inside the event, in dB. */
  readonly peakDb: number;
  /** How far the peak sits above the video's own baseline loudness, in dB. */
  readonly prominenceDb: number;
  readonly kind: AudioEventKind;
}

/** A stretch of near-silence — useful for finding dead air and content gaps. */
export interface SilenceRange {
  readonly startSecond: number;
  readonly endSecond: number;
}

export interface AudioAnalysis {
  /** Median RMS across the whole video — the "normal" level to compare against. */
  readonly baselineDb: number;
  readonly peaks: readonly EnergyPeak[];
  readonly events: readonly AudioEvent[];
  readonly silences: readonly SilenceRange[];
}

/** Seconds per RMS reading. 0.5s resolves a short laugh; 1s (the old value) did not. */
const FRAME_SECONDS = 0.5;
const SAMPLE_RATE = 16_000;
/** dB above the baseline that counts as "loud". ~6 dB is a clear, audible surge. */
const LOUD_OVER_BASELINE = 6;
/** dB below baseline that counts as silence. */
const QUIET_UNDER_BASELINE = 15;
/** Loud frames closer together than this are treated as one event. */
const EVENT_MERGE_GAP_SECONDS = 1.0;
/** At or above this duration an event is a sustained surge, not a brief spike. */
const SURGE_MIN_SECONDS = 1.5;
/** Silence shorter than this is just a normal pause between sentences. */
const SILENCE_MIN_SECONDS = 1.5;

const EMPTY: AudioAnalysis = { baselineDb: -30, peaks: [], events: [], silences: [] };

/**
 * Full analysis. One ffmpeg pass, audio only.
 */
export async function analyzeAudio(videoPath: string): Promise<AudioAnalysis> {
  const readings = await readRms(videoPath);
  if (readings.length < 5) return EMPTY;

  const sorted = readings.map((r) => r.db).sort((a, b) => a - b);
  const baselineDb = sorted[Math.floor(sorted.length / 2)] ?? -30;
  const loudThreshold = baselineDb + LOUD_OVER_BASELINE;
  const quietThreshold = baselineDb - QUIET_UNDER_BASELINE;

  const peaks: EnergyPeak[] = [];
  for (const reading of readings) {
    if (reading.db >= loudThreshold) {
      peaks.push({ second: Math.round(reading.second), db: Math.round(reading.db) });
    }
  }

  return {
    baselineDb: Math.round(baselineDb),
    // De-duplicate the per-second view (two 0.5s frames can round to one second).
    peaks: dedupeBySecond(peaks),
    events: groupEvents(readings, loudThreshold, baselineDb),
    silences: groupSilences(readings, quietThreshold),
  };
}

/**
 * Backward-compatible wrapper: just the loud seconds. Existing callers and the
 * selector prompt keep working unchanged.
 */
export async function energyPeaks(videoPath: string): Promise<readonly EnergyPeak[]> {
  return (await analyzeAudio(videoPath)).peaks;
}

/* ----------------------------- measurement ----------------------------- */

interface Reading {
  readonly second: number;
  readonly db: number;
}

async function readRms(videoPath: string): Promise<Reading[]> {
  try {
    const samplesPerFrame = Math.round(SAMPLE_RATE * FRAME_SECONDS);
    const { stderr } = await execFileAsync(
      await resolveMediaTool("ffmpeg"),
      [
        "-hide_banner",
        "-nostats",
        "-vn", // audio only — never waste time decoding video here
        "-i",
        videoPath,
        // Resample to mono 16k, pack fixed-size frames, then astats prints one
        // RMS value per frame. ametadata must print the FULL frame metadata:
        // filtering it to a single key suppresses the pts_time line, which once
        // left us with timestamps missing and zero usable peaks.
        "-af",
        `aresample=${SAMPLE_RATE},pan=mono|c0=c0,asetnsamples=n=${samplesPerFrame}:p=0,` +
          "astats=metadata=1:reset=1,ametadata=mode=print",
        "-f",
        "null",
        "-",
      ],
      { maxBuffer: 1024 * 1024 * 256, timeout: 10 * 60_000 },
    );

    const readings: Reading[] = [];
    let pendingTime: number | undefined;
    for (const line of stderr.split(/\r?\n/)) {
      const timeMatch = line.match(/pts_time:([\d.]+)/);
      if (timeMatch) {
        pendingTime = Number.parseFloat(timeMatch[1] ?? "");
        continue;
      }
      const rmsMatch = line.match(/lavfi\.astats\.Overall\.RMS_level=(-?[\d.]+|-?inf)/);
      if (rmsMatch && pendingTime !== undefined) {
        const raw = rmsMatch[1] ?? "";
        const db = raw.includes("inf") ? -120 : Number.parseFloat(raw);
        if (Number.isFinite(db) && Number.isFinite(pendingTime)) {
          readings.push({ second: pendingTime, db });
        }
        pendingTime = undefined;
      }
    }
    return readings;
  } catch {
    return [];
  }
}

/* ------------------------------ grouping ------------------------------ */

function groupEvents(readings: readonly Reading[], loudThreshold: number, baselineDb: number): AudioEvent[] {
  const events: AudioEvent[] = [];
  let start: number | undefined;
  let end = 0;
  let peakDb = -120;

  const flush = (): void => {
    if (start === undefined) return;
    // A single frame still has real duration; never report a zero-length event.
    const endSecond = Math.max(end, start + FRAME_SECONDS);
    const durationSeconds = endSecond - start;
    events.push({
      startSecond: round1(start),
      endSecond: round1(endSecond),
      durationSeconds: round1(durationSeconds),
      peakDb: Math.round(peakDb),
      prominenceDb: Math.round(peakDb - baselineDb),
      kind: durationSeconds >= SURGE_MIN_SECONDS ? "surge" : "spike",
    });
    start = undefined;
    peakDb = -120;
  };

  for (const reading of readings) {
    if (reading.db >= loudThreshold) {
      if (start === undefined) {
        start = reading.second;
      } else if (reading.second - end > EVENT_MERGE_GAP_SECONDS) {
        // Gap too wide — this is a new event, not a continuation.
        flush();
        start = reading.second;
      }
      end = reading.second + FRAME_SECONDS;
      peakDb = Math.max(peakDb, reading.db);
    }
  }
  flush();

  // Strongest first: a long, very loud surge outranks a brief blip.
  return events.sort((a, b) => eventStrength(b) - eventStrength(a));
}

/**
 * Rank events by prominence weighted by how long they sustain. The log keeps a
 * 20-second roar from completely burying a 2-second one — sustained matters, but
 * not linearly.
 */
export function eventStrength(event: AudioEvent): number {
  return event.prominenceDb * (1 + Math.log1p(event.durationSeconds));
}

function groupSilences(readings: readonly Reading[], quietThreshold: number): SilenceRange[] {
  const silences: SilenceRange[] = [];
  let start: number | undefined;
  let end = 0;

  const flush = (): void => {
    if (start !== undefined && end - start >= SILENCE_MIN_SECONDS) {
      silences.push({ startSecond: round1(start), endSecond: round1(end) });
    }
    start = undefined;
  };

  for (const reading of readings) {
    if (reading.db <= quietThreshold) {
      if (start === undefined) start = reading.second;
      end = reading.second + FRAME_SECONDS;
    } else {
      flush();
    }
  }
  flush();
  return silences;
}

function dedupeBySecond(peaks: readonly EnergyPeak[]): EnergyPeak[] {
  const bySecond = new Map<number, number>();
  for (const peak of peaks) {
    const existing = bySecond.get(peak.second);
    if (existing === undefined || peak.db > existing) bySecond.set(peak.second, peak.db);
  }
  return [...bySecond.entries()]
    .map(([second, db]) => ({ second, db }))
    .sort((a, b) => a.second - b.second);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
