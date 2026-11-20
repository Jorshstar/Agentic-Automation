import { describe, it, expect } from "vitest";
import { isDocumentaryJob } from "./clip-queue.js";
import type { StudioJob } from "./clip-queue.js";

/**
 * Clips and documentaries share one queue, so the worker has to tell them
 * apart. Clip jobs predate the `kind` field and are still written without it,
 * which is the case most likely to break quietly: a clip job read as a
 * documentary would try to research a YouTube URL as a topic.
 */
describe("isDocumentaryJob", () => {
  it("recognises a documentary job", () => {
    const job: StudioJob = { kind: "documentary", topic: "the history of Nokia" };
    expect(isDocumentaryJob(job)).toBe(true);
  });

  it("recognises a documentary with no topic — meaning 'continue'", () => {
    expect(isDocumentaryJob({ kind: "documentary", topic: "" })).toBe(true);
  });

  it("treats a clip job WITHOUT a kind as a clip", () => {
    // Jobs queued before the field existed, and the ones the clip path still
    // writes today, have no `kind` at all.
    const legacy = { url: "https://youtu.be/x", theme: "the goals", count: 5 } as StudioJob;
    expect(isDocumentaryJob(legacy)).toBe(false);
  });

  it("treats an explicit clip job as a clip", () => {
    const job: StudioJob = { kind: "clip", url: "https://youtu.be/x", theme: "auto", count: 3 };
    expect(isDocumentaryJob(job)).toBe(false);
  });

  it("does not mistake an upload-based clip job for a documentary", () => {
    const job = { url: "", fileId: "abc123", theme: "funny", count: 2 } as StudioJob;
    expect(isDocumentaryJob(job)).toBe(false);
  });
});
