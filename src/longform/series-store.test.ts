import { describe, it, expect } from "vitest";
import { MirroredSeriesStore } from "./series.js";
import type { SeriesRecord, SeriesStore } from "./series.js";

const record = (seriesId: string, parts = 1): SeriesRecord => ({
  seriesId,
  topic: seriesId,
  citations: [],
  parts: Array.from({ length: parts }, (_, i) => ({
    part: i + 1,
    title: `Part ${i + 1}`,
    summary: "",
    lastLine: "",
    createdAt: new Date(0).toISOString(),
  })),
  complete: false,
});

class Memory implements SeriesStore {
  readonly saved: SeriesRecord[] = [];
  constructor(private readonly broken = false) {}
  async get(id: string): Promise<SeriesRecord | undefined> {
    if (this.broken) throw new Error("fetch failed");
    return this.saved.find((r) => r.seriesId === id);
  }
  async save(r: SeriesRecord): Promise<void> {
    if (this.broken) throw new Error("fetch failed");
    this.saved.push(r);
  }
  async list(): Promise<readonly SeriesRecord[]> {
    if (this.broken) throw new Error("fetch failed");
    return this.saved;
  }
}

/**
 * This record is what part two reads to know what part one said. Losing it
 * means the next part retells the story — but a save that cannot complete must
 * not cost the finished video either. A McDonald's part 1 rendered fully, drew
 * its cover, wrote its upload kit, and then stopped dead for thirteen minutes
 * inside an unbounded save, delivering nothing.
 */
describe("MirroredSeriesStore", () => {
  it("keeps the record locally when the remote save fails", async () => {
    const local = new Memory();
    const warnings: string[] = [];
    const store = new MirroredSeriesStore(new Memory(true), local, (m) => warnings.push(m));

    await expect(store.save(record("mcdonalds"))).resolves.toBeUndefined();
    expect(local.saved).toHaveLength(1);
    expect(warnings[0]).toContain("kept locally");
  });

  it("writes to both when the remote is healthy", async () => {
    const local = new Memory();
    const remote = new Memory();
    await new MirroredSeriesStore(remote, local).save(record("nintendo"));
    expect(local.saved).toHaveLength(1);
    expect(remote.saved).toHaveLength(1);
  });

  it("prefers the remote on read — the cloud may know a part this machine does not", async () => {
    const local = new Memory();
    const remote = new Memory();
    await local.save(record("nokia", 1));
    await remote.save(record("nokia", 3));
    const found = await new MirroredSeriesStore(remote, local).get("nokia");
    expect(found?.parts).toHaveLength(3);
  });

  it("falls back to the local copy when the remote read fails", async () => {
    const local = new Memory();
    await local.save(record("nokia", 2));
    const found = await new MirroredSeriesStore(new Memory(true), local).get("nokia");
    expect(found?.parts).toHaveLength(2);
  });

  it("lists from the local copy when the remote is down", async () => {
    const local = new Memory();
    await local.save(record("nokia"));
    expect(await new MirroredSeriesStore(new Memory(true), local).list()).toHaveLength(1);
  });
});
