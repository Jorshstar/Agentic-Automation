import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * RunLedger — the studio's flight recorder + checkpoint system.
 *
 * Every run gets its own isolated directory (`output/runs/<runId>/`) holding a
 * `run.json` record (status, stages, costs, errors) and one JSON checkpoint per
 * completed stage. That buys three enterprise properties:
 *
 *   1. ISOLATION  — runs never share work dirs, so they can't corrupt each other.
 *   2. RESUME     — re-running with the same runId skips completed stages and
 *                   loads their checkpoints, so a crash at stage 9 doesn't re-pay
 *                   for stages 1-8 (images, narration...).
 *   3. AUDIT      — what ran, when, what it cost, and where it failed is on disk.
 *
 * Stage results must be JSON-serializable (all studio stage results are: plain
 * data + file paths into the run directory).
 */

export type RunStatus = "running" | "completed" | "failed" | "blocked";
export type StageStatus = "completed" | "failed";

export interface StageRecord {
  readonly name: string;
  readonly status: StageStatus;
  readonly costUsd: number;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly error?: string;
}

export interface RunRecord {
  readonly runId: string;
  readonly niche: string;
  status: RunStatus;
  topic: string;
  stages: StageRecord[];
  totalCostUsd: number;
  readonly createdAt: string;
  updatedAt: string;
  error?: string;
}

/** Thrown when a stage fails — carries enough context to alert + resume. */
export class StudioStageError extends Error {
  readonly runId: string;
  readonly stage: string;

  constructor(runId: string, stage: string, cause: unknown) {
    super(
      `Run "${runId}" failed at stage "${stage}": ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = "StudioStageError";
    this.runId = runId;
    this.stage = stage;
  }
}

/** Build a fresh run id: "<niche>-<timestamp>" (doubles as the final dir name). */
export function makeRunId(niche: string): string {
  return `${niche}-${new Date().toISOString().replace(/[:.]/gu, "-")}`;
}

export class RunLedger {
  /** Stages that were loaded from checkpoints (not re-run) in THIS session. */
  readonly resumedStages: string[] = [];

  private constructor(
    readonly runId: string,
    readonly runDir: string,
    readonly record: RunRecord,
  ) {}

  /** Open (resume) or create the ledger for a run. */
  static async open(runId: string, niche: string, rootDir = "output/runs"): Promise<RunLedger> {
    const runDir = join(rootDir, runId).replace(/\\/gu, "/");
    await mkdir(join(runDir, "stages"), { recursive: true });

    const recordPath = join(runDir, "run.json");
    let record: RunRecord;
    try {
      record = JSON.parse(await readFile(recordPath, "utf8")) as RunRecord;
      record.status = "running"; // resuming
    } catch {
      record = {
        runId,
        niche,
        status: "running",
        topic: "",
        stages: [],
        totalCostUsd: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
    const ledger = new RunLedger(runId, runDir, record);
    await ledger.save();
    return ledger;
  }

  /**
   * Run a stage with checkpointing. If this stage already completed in a prior
   * session of the same runId, its checkpoint is loaded and `fn` is NOT run —
   * that's the resume. On failure the ledger records where and why, then throws
   * a {@link StudioStageError}.
   */
  async stage<T>(name: string, fn: () => Promise<T>, costOf?: (result: T) => number): Promise<T> {
    const checkpointPath = join(this.runDir, "stages", `${name}.json`);
    const existing = this.record.stages.find((s) => s.name === name && s.status === "completed");
    if (existing) {
      try {
        const loaded = JSON.parse(await readFile(checkpointPath, "utf8")) as T;
        this.resumedStages.push(name);
        return loaded;
      } catch {
        // Checkpoint unreadable → fall through and re-run the stage.
      }
    }

    const startedAt = new Date().toISOString();
    try {
      const result = await fn();
      const costUsd = costOf ? costOf(result) : 0;
      await writeFile(checkpointPath, JSON.stringify(result, null, 2), "utf8");
      this.pushStage({ name, status: "completed", costUsd, startedAt, finishedAt: new Date().toISOString() });
      await this.save();
      return result;
    } catch (error) {
      this.pushStage({
        name,
        status: "failed",
        costUsd: 0,
        startedAt,
        finishedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
      this.record.status = "failed";
      this.record.error = `stage "${name}": ${error instanceof Error ? error.message : String(error)}`;
      await this.save();
      throw new StudioStageError(this.runId, name, error);
    }
  }

  /** Lifetime cost of this run (sums every completed stage, across sessions). */
  totalCostUsd(): number {
    return Math.round(this.record.stages.reduce((sum, s) => sum + s.costUsd, 0) * 10_000) / 10_000;
  }

  async setTopic(topic: string): Promise<void> {
    this.record.topic = topic;
    await this.save();
  }

  async setStatus(status: RunStatus, error?: string): Promise<void> {
    this.record.status = status;
    if (error !== undefined) {
      this.record.error = error;
    }
    await this.save();
  }

  /** Replace any previous record for this stage name (e.g. failed → completed). */
  private pushStage(stage: StageRecord): void {
    this.record.stages = [...this.record.stages.filter((s) => s.name !== stage.name), stage];
    this.record.totalCostUsd = this.totalCostUsd();
  }

  private async save(): Promise<void> {
    this.record.updatedAt = new Date().toISOString();
    await writeFile(join(this.runDir, "run.json"), JSON.stringify(this.record, null, 2), "utf8");
  }
}
