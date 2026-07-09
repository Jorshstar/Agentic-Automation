import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunLedger, StudioStageError, makeRunId } from "./run-ledger.js";

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "ledger-test-"));
}

describe("RunLedger", () => {
  it("runs a stage, checkpoints it, and records its cost", async () => {
    const root = await tempRoot();
    const ledger = await RunLedger.open("run-1", "scary-stories", root);

    const result = await ledger.stage("alpha", async () => ({ value: 42 }), () => 0.05);
    expect(result.value).toBe(42);
    expect(ledger.totalCostUsd()).toBe(0.05);
    expect(ledger.record.stages[0]?.status).toBe("completed");
  });

  it("RESUMES: a completed stage is loaded from its checkpoint, not re-run", async () => {
    const root = await tempRoot();
    const first = await RunLedger.open("run-2", "tech-news", root);
    let executions = 0;
    await first.stage("expensive", async () => {
      executions += 1;
      return { paid: true };
    }, () => 0.3);

    // Same runId, new session — the stage function must NOT run again.
    const second = await RunLedger.open("run-2", "tech-news", root);
    const loaded = await second.stage("expensive", async () => {
      executions += 1;
      return { paid: false };
    }, () => 0.3);

    expect(executions).toBe(1);
    expect(loaded.paid).toBe(true); // the checkpointed value, not the new fn
    expect(second.resumedStages).toContain("expensive");
    expect(second.totalCostUsd()).toBe(0.3); // cost counted once
  });

  it("records a failed stage and throws StudioStageError with runId + stage", async () => {
    const root = await tempRoot();
    const ledger = await RunLedger.open("run-3", "scary-stories", root);

    await expect(
      ledger.stage("boom", async () => {
        throw new Error("provider exploded");
      }),
    ).rejects.toThrowError(StudioStageError);

    expect(ledger.record.status).toBe("failed");
    expect(ledger.record.stages.find((s) => s.name === "boom")?.status).toBe("failed");
    expect(ledger.record.error).toContain("provider exploded");
  });

  it("a failed stage re-runs on resume (only completed stages are skipped)", async () => {
    const root = await tempRoot();
    const first = await RunLedger.open("run-4", "scary-stories", root);
    await first.stage("flaky", async () => {
      throw new Error("first try fails");
    }).catch(() => undefined);

    const second = await RunLedger.open("run-4", "scary-stories", root);
    const result = await second.stage("flaky", async () => ({ ok: true }));
    expect(result.ok).toBe(true);
    expect(second.record.stages.find((s) => s.name === "flaky")?.status).toBe("completed");
  });

  it("preserves the original niche when resuming", async () => {
    const root = await tempRoot();
    await RunLedger.open("run-5", "relationship-advice", root);
    const resumed = await RunLedger.open("run-5", "scary-stories", root);
    expect(resumed.record.niche).toBe("relationship-advice");
  });

  it("makeRunId starts with the niche", () => {
    expect(makeRunId("tech-news").startsWith("tech-news-")).toBe(true);
  });
});
