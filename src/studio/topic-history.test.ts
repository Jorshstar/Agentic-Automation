import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileTopicHistoryStore, normalizeTitle } from "./topic-history.js";

async function tempStore(): Promise<FileTopicHistoryStore> {
  const dir = await mkdtemp(join(tmpdir(), "history-test-"));
  return new FileTopicHistoryStore(join(dir, "used-topics.json"));
}

describe("normalizeTitle", () => {
  it("treats case/punctuation/spacing variants as the same topic", () => {
    expect(normalizeTitle("The 4th  Floor Button!")).toBe(normalizeTitle("the 4th floor button"));
  });

  it("distinguishes genuinely different topics", () => {
    expect(normalizeTitle("The 4th Floor Button")).not.toBe(normalizeTitle("The Wrong Bus"));
  });
});

describe("FileTopicHistoryStore", () => {
  it("starts empty and remembers added topics, newest first", async () => {
    const store = await tempStore();
    expect(await store.recent(10)).toEqual([]);

    await store.add({ title: "First", niche: "scary-stories", date: "2026-07-01" });
    await store.add({ title: "Second", niche: "tech-news", date: "2026-07-02" });

    const recent = await store.recent(10);
    expect(recent.map((t) => t.title)).toEqual(["Second", "First"]);
  });

  it("respects the recent() limit", async () => {
    const store = await tempStore();
    for (let i = 0; i < 5; i += 1) {
      await store.add({ title: `Topic ${i}`, niche: "scary-stories", date: "2026-07-01" });
    }
    expect((await store.recent(2)).length).toBe(2);
  });

  it("never throws on a missing/corrupt file (best-effort memory)", async () => {
    const store = new FileTopicHistoryStore("Z:/definitely/not/a/real/path/topics.json");
    expect(await store.recent(5)).toEqual([]);
    await expect(
      store.add({ title: "X", niche: "scary-stories", date: "2026-07-01" }),
    ).resolves.toBeUndefined();
  });
});
