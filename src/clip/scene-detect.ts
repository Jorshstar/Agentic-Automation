import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveMediaTool } from "../lib/binaries.js";

const execFileAsync = promisify(execFile);

/**
 * SCENE-CUT DETECTION — finds the timestamps where the picture changes hard
 * (a cut, an angle change, a replay starting).
 *
 * Why it matters for clipping: in sports and reaction content the edit itself
 * tells you where the highlight is. A goal is followed by a BURST of cuts (the
 * replays from three angles); a dull passage of play has none. Combined with a
 * crowd roar this is a strong, completely free "something big happened here"
 * detector that needs no AI and no pixel understanding.
 *
 * Cost control: decoding a 2-hour video at full resolution would take minutes,
 * so we decimate to 4 fps and 320px wide first. Scene scores are computed on
 * those decimated frames, which is plenty to spot a hard cut, and runs roughly
 * an order of magnitude faster. Callers only run this when the theme plan says
 * scene data is worth it (see ThemePlan.needsSceneDetection).
 *
 * Never throws — on any failure it returns [] and the caller falls back to the
 * audio and transcript signals.
 */

export interface SceneCut {
  /** Seconds from the start of the video. */
  readonly second: number;
  /** ffmpeg's scene score 0..1 (higher = more different from the previous frame). */
  readonly score: number;
}

/** Below this, a "change" is usually camera motion or a flash, not a real cut. */
const SCENE_THRESHOLD = 0.35;
const ANALYSIS_FPS = 4;
const ANALYSIS_WIDTH = 320;

export async function detectSceneCuts(videoPath: string): Promise<readonly SceneCut[]> {
  try {
    const { stderr } = await execFileAsync(
      await resolveMediaTool("ffmpeg"),
      [
        "-hide_banner",
        "-nostats",
        // `metadata=print` writes to stderr at info level, so we must NOT use
        // the usual -loglevel error here or we would parse an empty string.
        "-loglevel",
        "info",
        "-i",
        videoPath,
        "-an", // audio is handled by audio-energy; skip decoding it here
        "-vf",
        `fps=${ANALYSIS_FPS},scale=${ANALYSIS_WIDTH}:-2,select='gt(scene\\,${SCENE_THRESHOLD})',metadata=print`,
        "-f",
        "null",
        "-",
      ],
      { maxBuffer: 1024 * 1024 * 256, timeout: 15 * 60_000 },
    );
    return parseSceneOutput(stderr);
  } catch {
    return [];
  }
}

/**
 * ffmpeg emits pairs of lines:
 *   frame:12  pts:4096  pts_time:8.5
 *   lavfi.scene_score=0.612
 * The timestamp line comes first, so we hold it until the score arrives.
 */
function parseSceneOutput(stderr: string): readonly SceneCut[] {
  const cuts: SceneCut[] = [];
  let pendingTime: number | undefined;
  for (const line of stderr.split(/\r?\n/)) {
    const timeMatch = line.match(/pts_time:([\d.]+)/);
    if (timeMatch) {
      pendingTime = Number.parseFloat(timeMatch[1] ?? "");
      continue;
    }
    const scoreMatch = line.match(/lavfi\.scene_score=([\d.]+)/);
    if (scoreMatch && pendingTime !== undefined && Number.isFinite(pendingTime)) {
      const score = Number.parseFloat(scoreMatch[1] ?? "");
      if (Number.isFinite(score)) cuts.push({ second: pendingTime, score });
      pendingTime = undefined;
    }
  }
  return cuts;
}

/**
 * How many cuts land in [from, to). This is the "replay burst" measure: 4+ cuts
 * in the 10 seconds after a crowd roar is a near-certain highlight, because that
 * is exactly how broadcast directors cut a goal replay.
 */
export function cutsInWindow(cuts: readonly SceneCut[], from: number, to: number): number {
  let count = 0;
  for (const cut of cuts) {
    if (cut.second >= from && cut.second < to) count++;
  }
  return count;
}

/** A run of cuts close together — in an edited package, one highlight. */
export interface CutBurst {
  readonly startSecond: number;
  readonly endSecond: number;
  readonly cuts: number;
}

/**
 * Find clusters of cuts: the shape an edited highlights package makes.
 *
 * This exists because surge detection fails on exactly that content. A crowd
 * roar works as a goal marker in a full match, where the crowd is quiet and
 * then erupts — but a highlights compilation is nothing BUT highlights, loud
 * from end to end, so nothing rises above its own baseline. One real run
 * produced 7 audio events and a single sustained surge across twelve minutes,
 * and the selector fell back to evenly-spaced guesses.
 *
 * The cut pattern survives where the audio does not. An editor cuts hard into a
 * goal, then through two or three replay angles, then back to play — so each
 * highlight is a tight burst of cuts separated by quieter stretches. The same
 * video had 28 cuts, which was the signal nobody was reading.
 */
export function findCutBursts(
  cuts: readonly SceneCut[],
  /** Cuts further apart than this belong to different highlights. */
  maxGapSeconds = 6,
  /** Fewer cuts than this is an ordinary edit, not a highlight. */
  minCuts = 2,
): readonly CutBurst[] {
  if (cuts.length === 0) return [];
  const ordered = [...cuts].sort((a, b) => a.second - b.second);

  const bursts: CutBurst[] = [];
  let start = ordered[0]!.second;
  let end = start;
  let count = 1;

  const flush = (): void => {
    if (count >= minCuts) bursts.push({ startSecond: start, endSecond: end, cuts: count });
  };

  for (const cut of ordered.slice(1)) {
    if (cut.second - end <= maxGapSeconds) {
      end = cut.second;
      count++;
    } else {
      flush();
      start = cut.second;
      end = cut.second;
      count = 1;
    }
  }
  flush();

  // Densest first: more cuts in a burst means more replay angles, which is how
  // an editor marks the moment that mattered most.
  return bursts.sort((a, b) => b.cuts - a.cuts);
}

/**
 * Snap a clip boundary to the nearest scene cut within `toleranceSeconds`, so a
 * clip starts on a clean edit rather than halfway through a shot. Returns the
 * original value when nothing is close enough — never moves a boundary far.
 */
export function snapToCut(second: number, cuts: readonly SceneCut[], toleranceSeconds = 1.2): number {
  let best = second;
  let bestDistance = toleranceSeconds;
  for (const cut of cuts) {
    const distance = Math.abs(cut.second - second);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = cut.second;
    }
  }
  return best;
}
