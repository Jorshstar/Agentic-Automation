import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Best-effort loudness scan: measures per-second RMS energy and returns the
 * timestamps that stand out (crowd roars, laughter, hype). This is the cheap
 * signal that makes theme clipping like "goals" or "reactions" work without any
 * pixel analysis. Never throws — on any failure it returns [] and selection
 * falls back to the transcript alone.
 */

export interface EnergyPeak {
  readonly second: number;
  /** RMS level in dB (higher = louder; typically -60..0). */
  readonly db: number;
}

export async function energyPeaks(videoPath: string): Promise<readonly EnergyPeak[]> {
  try {
    // One RMS reading per second: resample mono, pack 16000 samples/frame (=1s),
    // then astats prints Overall.RMS_level per frame with its pts_time.
    const { stderr } = await execFileAsync(
      "ffmpeg",
      [
        "-hide_banner", "-nostats",
        "-vn", // audio only — don't waste time decoding the video stream
        "-i", videoPath,
        // NOTE: filtering ametadata to a single key suppresses the pts_time line,
        // which left us with no timestamps (0 peaks). Print full frame metadata;
        // the parser picks out pts_time + Overall.RMS_level and ignores the rest.
        "-af", "aresample=16000,pan=mono|c0=c0,asetnsamples=n=16000:p=0,astats=metadata=1:reset=1,ametadata=mode=print",
        "-f", "null", "-",
      ],
      { maxBuffer: 1024 * 1024 * 256, timeout: 5 * 60_000 },
    );

    const readings: { second: number; db: number }[] = [];
    let pendingTime: number | undefined;
    for (const line of stderr.split(/\r?\n/)) {
      const timeMatch = line.match(/pts_time:([\d.]+)/);
      if (timeMatch) {
        pendingTime = Number.parseFloat(timeMatch[1] ?? "");
        continue;
      }
      const rms = line.match(/lavfi\.astats\.Overall\.RMS_level=(-?[\d.]+|-?inf)/);
      if (rms && pendingTime !== undefined) {
        const db = rms[1] === "-inf" ? -120 : Number.parseFloat(rms[1] ?? "");
        if (Number.isFinite(db)) readings.push({ second: Math.round(pendingTime), db });
        pendingTime = undefined;
      }
    }
    if (readings.length < 5) return [];

    // A peak = a reading meaningfully above the median (robust to outliers).
    const sorted = [...readings].map((r) => r.db).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? -30;
    const threshold = median + 6; // ~6 dB over median ≈ a clear, sustained surge
    return readings
      .filter((r) => r.db >= threshold)
      .map((r) => ({ second: r.second, db: Math.round(r.db) }));
  } catch {
    return [];
  }
}
