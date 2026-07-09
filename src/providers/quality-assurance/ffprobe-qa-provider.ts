import { probeJson } from "../../lib/media.js";
import type { QualityAssuranceProvider } from "./quality-assurance-provider.js";
import type {
  QaContext,
  QaRequest,
  QaReport,
  QaCheck,
  QaProbe,
  QaStatus,
  QaSeverity,
  QaMetadata,
} from "./types.js";

/**
 * FfprobeQaProvider — validates a rendered MP4 with ffprobe.
 *
 * Read-only: it probes the file and runs a checklist, returning a structured
 * report. It never edits or re-renders. A missing/unreadable file fails cleanly
 * (not a crash), and every check carries its own status + severity so callers can
 * decide what blocks publishing.
 */

const DEFAULT_QA_CONTEXT: QaContext = {
  expectedWidth: 1080,
  expectedHeight: 1920,
  durationTolerance: 0.15,
  requireAudio: true,
  minSizeBytes: 50_000,
};

export class FfprobeQaProvider implements QualityAssuranceProvider {
  readonly name = "ffprobe-qa-provider";

  private lastReport: QaReport | undefined;

  constructor(private readonly context: QaContext = DEFAULT_QA_CONTEXT) {}

  get last(): QaReport | undefined {
    return this.lastReport;
  }

  async review(request: QaRequest): Promise<QaReport> {
    const ctx: QaContext = { ...this.context, ...request.context };
    const startedAt = Date.now();

    const probe = await inspect(request.videoPath);
    const checks = buildChecks(probe, ctx);

    const errorCount = checks.filter((c) => c.severity === "error" && c.status === "fail").length;
    const warningCount = checks.filter((c) => c.status === "warn").length;
    const status: QaStatus = errorCount > 0 ? "fail" : warningCount > 0 ? "warn" : "pass";

    const metadata: QaMetadata = {
      provider: this.name,
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
      errorCount,
      warningCount,
    };

    const report: QaReport = {
      videoPath: request.videoPath,
      passed: errorCount === 0,
      status,
      checks,
      probe,
      metadata,
    };
    this.lastReport = report;
    return report;
  }
}

/** Probe the file into the flat facts QA reasons about. */
async function inspect(videoPath: string): Promise<QaProbe> {
  const empty: QaProbe = {
    exists: false,
    sizeBytes: 0,
    durationSeconds: 0,
    hasVideo: false,
    hasAudio: false,
    width: 0,
    height: 0,
    fps: 0,
    videoCodec: "",
    audioCodec: "",
  };

  const json = await probeJson(videoPath);
  if (!json || typeof json !== "object") {
    return empty;
  }

  const root = json as Record<string, unknown>;
  const format = asRecord(root["format"]);
  const streams = Array.isArray(root["streams"]) ? (root["streams"] as unknown[]) : [];

  const video = streams.map(asRecord).find((s) => asString(s["codec_type"]) === "video");
  const audio = streams.map(asRecord).find((s) => asString(s["codec_type"]) === "audio");

  return {
    exists: true,
    sizeBytes: asNumber(format["size"]),
    durationSeconds: round3(asNumber(format["duration"])),
    hasVideo: video !== undefined,
    hasAudio: audio !== undefined,
    width: asNumber(video?.["width"]),
    height: asNumber(video?.["height"]),
    fps: parseFps(asString(video?.["r_frame_rate"])),
    videoCodec: asString(video?.["codec_name"]),
    audioCodec: asString(audio?.["codec_name"]),
  };
}

/** Run the checklist against the probe + expectations. */
function buildChecks(probe: QaProbe, ctx: QaContext): QaCheck[] {
  const checks: QaCheck[] = [];
  const add = (id: string, label: string, ok: boolean, severity: QaSeverity, detail: string): void => {
    checks.push({ id, label, status: ok ? "pass" : severity === "error" ? "fail" : "warn", severity, detail });
  };

  if (!probe.exists) {
    add("file-exists", "File exists & readable", false, "error", "ffprobe could not read the file.");
    return checks; // nothing else is meaningful
  }
  add("file-exists", "File exists & readable", true, "error", "OK");
  add("file-size", "Non-trivial file size", probe.sizeBytes >= ctx.minSizeBytes, "error", `${(probe.sizeBytes / 1024 / 1024).toFixed(2)} MB`);
  add("video-stream", "Has a video stream", probe.hasVideo, "error", probe.hasVideo ? probe.videoCodec : "none");

  if (ctx.requireAudio) {
    add("audio-stream", "Has an audio stream", probe.hasAudio, "error", probe.hasAudio ? probe.audioCodec : "none");
  }

  const dimsOk = probe.width === ctx.expectedWidth && probe.height === ctx.expectedHeight;
  add("dimensions", "Correct dimensions", dimsOk, "error", `${probe.width}x${probe.height} (expected ${ctx.expectedWidth}x${ctx.expectedHeight})`);

  add("framerate", "Sane frame rate", probe.fps >= 15 && probe.fps <= 60, "warning", `${probe.fps} fps`);
  add("video-codec", "H.264 video", probe.videoCodec === "h264", "warning", probe.videoCodec || "unknown");

  if (ctx.requireAudio) {
    add("audio-codec", "AAC audio", probe.audioCodec === "aac", "warning", probe.audioCodec || "unknown");
  }

  if (ctx.expectedDurationSeconds !== undefined && ctx.expectedDurationSeconds > 0) {
    const drift = Math.abs(probe.durationSeconds - ctx.expectedDurationSeconds);
    const allowed = ctx.expectedDurationSeconds * ctx.durationTolerance;
    add(
      "duration",
      "Duration matches narration",
      drift <= allowed,
      "error",
      `${probe.durationSeconds}s vs expected ${round3(ctx.expectedDurationSeconds)}s (±${Math.round(ctx.durationTolerance * 100)}%)`,
    );
  } else {
    add("duration", "Has a positive duration", probe.durationSeconds > 0, "error", `${probe.durationSeconds}s`);
  }

  // Absolute platform bounds (e.g. the 60s Shorts floor) — independent of the
  // narration-drift check above, and BLOCKING when violated.
  if (ctx.minDurationSeconds !== undefined) {
    add(
      "duration-floor",
      `Duration ≥ ${ctx.minDurationSeconds}s (platform floor)`,
      probe.durationSeconds >= ctx.minDurationSeconds,
      "error",
      `${probe.durationSeconds}s`,
    );
  }
  if (ctx.maxDurationSeconds !== undefined) {
    add(
      "duration-ceiling",
      `Duration ≤ ${ctx.maxDurationSeconds}s (platform ceiling)`,
      probe.durationSeconds <= ctx.maxDurationSeconds,
      "error",
      `${probe.durationSeconds}s`,
    );
  }

  return checks;
}

/* ------------------------------- parse helpers ------------------------------ */

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/** Parse "30/1" → 30. */
function parseFps(value: string): number {
  const match = value.match(/^(\d+)\/(\d+)$/u);
  if (!match) {
    return asNumber(value);
  }
  const num = Number(match[1]);
  const den = Number(match[2]);
  return den > 0 ? Math.round((num / den) * 100) / 100 : 0;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
