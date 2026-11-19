import { stat } from "node:fs/promises";
import { probeJson } from "../lib/media.js";

/**
 * CLIP QA — a last check before a clip is delivered.
 *
 * ffmpeg exits 0 in several situations that still produce something unusable: a
 * filter that silently dropped the audio, a seek past the end of the file that
 * yielded a fraction of a second, a crop that produced the wrong geometry. Those
 * reach the user as a broken upload unless something looks at the output, so
 * this probes the finished file rather than trusting the exit code.
 *
 * Never throws — an unprobeable file is reported as a failure, not an exception.
 */

export interface QaIssue {
  readonly code:
    | "missing"
    | "too-small"
    | "no-video"
    | "no-audio"
    | "wrong-size"
    | "too-short"
    | "too-long"
    | "unprobeable";
  readonly detail: string;
}

export interface QaResult {
  readonly ok: boolean;
  readonly issues: readonly QaIssue[];
  readonly durationSeconds?: number;
  readonly width?: number;
  readonly height?: number;
}

/** Below this a "video" is a header and nothing else. */
const MIN_BYTES = 40_000;
/** A clip shorter than this cannot carry a thought, whatever the theme. */
const MIN_SECONDS = 4;
const EXPECTED_WIDTH = 1080;
const EXPECTED_HEIGHT = 1920;

export async function checkClip(path: string, expectedSeconds?: number): Promise<QaResult> {
  const issues: QaIssue[] = [];

  let bytes: number;
  try {
    bytes = (await stat(path)).size;
  } catch {
    return { ok: false, issues: [{ code: "missing", detail: "output file was not created" }] };
  }
  if (bytes < MIN_BYTES) {
    issues.push({ code: "too-small", detail: `${bytes} bytes — render produced nothing usable` });
  }

  const json = (await probeJson(path)) as
    | {
        streams?: { codec_type?: string; width?: number; height?: number }[];
        format?: { duration?: string };
      }
    | undefined;
  if (!json) {
    issues.push({ code: "unprobeable", detail: "ffprobe could not read the file" });
    return { ok: false, issues };
  }

  const video = json.streams?.find((stream) => stream.codec_type === "video");
  const audio = json.streams?.find((stream) => stream.codec_type === "audio");
  const duration = Number.parseFloat(json.format?.duration ?? "");

  if (!video) {
    issues.push({ code: "no-video", detail: "no video stream" });
  } else if (video.width !== EXPECTED_WIDTH || video.height !== EXPECTED_HEIGHT) {
    issues.push({
      code: "wrong-size",
      detail: `${video.width}x${video.height}, expected ${EXPECTED_WIDTH}x${EXPECTED_HEIGHT}`,
    });
  }

  // A silent clip is a failed clip — short-form without audio does not work.
  if (!audio) issues.push({ code: "no-audio", detail: "no audio stream" });

  if (!Number.isFinite(duration) || duration < MIN_SECONDS) {
    issues.push({ code: "too-short", detail: `${duration || 0}s` });
  } else if (expectedSeconds !== undefined && duration < expectedSeconds * 0.5) {
    // Half the expected length means the seek or the trim went wrong.
    issues.push({
      code: "too-short",
      detail: `${duration.toFixed(1)}s vs ${expectedSeconds.toFixed(1)}s expected`,
    });
  } else if (expectedSeconds !== undefined && duration > expectedSeconds * 1.4 + 2) {
    // Longer than asked for means the trim did not apply at all — which is
    // exactly what happens when an ffmpeg `-t` binds to the wrong input. Left
    // unchecked it ships a clip running to the end of the source.
    issues.push({
      code: "too-long",
      detail: `${duration.toFixed(1)}s vs ${expectedSeconds.toFixed(1)}s expected — trim did not apply`,
    });
  }

  return {
    ok: issues.length === 0,
    issues,
    durationSeconds: Number.isFinite(duration) ? duration : undefined,
    width: video?.width,
    height: video?.height,
  };
}

/** One-line summary for logs and Telegram. */
export function describeIssues(issues: readonly QaIssue[]): string {
  return issues.map((issue) => `${issue.code} (${issue.detail})`).join(", ");
}
