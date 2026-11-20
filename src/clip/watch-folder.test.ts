import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  themeFromName,
  scanWatchFolder,
  StabilityTracker,
  ensureWatchFolders,
  archive,
  watchFolders,
} from "./watch-folder.js";

describe("themeFromName", () => {
  it("reads the request from after the separator", () => {
    expect(themeFromName("PSG vs Barca -- the goals.mp4")).toBe("the goals");
    expect(themeFromName("podcast -- key insights, with subtitles.mkv")).toBe(
      "key insights, with subtitles",
    );
  });

  it("is empty when no theme was given", () => {
    expect(themeFromName("stream.mp4")).toBe("");
    expect(themeFromName("my-video.mov")).toBe("");
  });

  it("does not mistake a hyphen in the title for the separator", () => {
    // "PSG-Barca" is a name, not a request; only " -- " separates.
    expect(themeFromName("PSG-Barca.mp4")).toBe("");
    expect(themeFromName("well-known-clip.mp4")).toBe("");
  });

  it("keeps a separator that appears inside the theme itself", () => {
    expect(themeFromName("x -- the goals -- vertical.mp4")).toBe("the goals -- vertical");
  });
});

describe("StabilityTracker", () => {
  it("waits for the size to stop changing before reporting ready", () => {
    const tracker = new StabilityTracker();
    // A big file still being copied grows between scans.
    expect(tracker.observe("a.mp4", 1000)).toBe(false);
    expect(tracker.observe("a.mp4", 5000)).toBe(false);
    expect(tracker.observe("a.mp4", 5000)).toBe(false); // first unchanged scan
    expect(tracker.observe("a.mp4", 5000)).toBe(true); // settled
  });

  it("starts over if the file grows again", () => {
    const tracker = new StabilityTracker();
    tracker.observe("a.mp4", 100);
    tracker.observe("a.mp4", 100);
    expect(tracker.observe("a.mp4", 200)).toBe(false);
  });

  it("forgets a file once handled", () => {
    const tracker = new StabilityTracker();
    tracker.observe("a.mp4", 100);
    tracker.observe("a.mp4", 100);
    tracker.forget("a.mp4");
    expect(tracker.observe("a.mp4", 100)).toBe(false);
  });
});

describe("scanWatchFolder", () => {
  let root: string;
  let folders: ReturnType<typeof watchFolders>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "watch-"));
    folders = watchFolders(root);
    await ensureWatchFolders(folders);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const settle = async (tracker: StabilityTracker) => {
    await scanWatchFolder(folders, tracker);
    await scanWatchFolder(folders, tracker);
    return scanWatchFolder(folders, tracker);
  };

  it("picks up a settled video and reads its theme", async () => {
    await writeFile(join(root, "match -- the goals.mp4"), "x".repeat(100));
    const ready = await settle(new StabilityTracker());
    expect(ready).toHaveLength(1);
    expect(ready[0]!.theme).toBe("the goals");
  });

  it("ignores a file that is still being written", async () => {
    const tracker = new StabilityTracker();
    const path = join(root, "big.mp4");
    await writeFile(path, "x".repeat(100));
    expect(await scanWatchFolder(folders, tracker)).toHaveLength(0);
    await writeFile(path, "x".repeat(500)); // still copying
    expect(await scanWatchFolder(folders, tracker)).toHaveLength(0);
  });

  it("ignores non-video files and dotfiles", async () => {
    await writeFile(join(root, "notes.txt"), "x");
    await writeFile(join(root, ".partial.mp4"), "x");
    await writeFile(join(root, "empty.mp4"), "");
    expect(await settle(new StabilityTracker())).toHaveLength(0);
  });

  it("never re-reads files already moved to done or failed", async () => {
    await writeFile(join(folders.done, "old.mp4"), "x".repeat(100));
    await writeFile(join(folders.failed, "bad.mp4"), "x".repeat(100));
    expect(await settle(new StabilityTracker())).toHaveLength(0);
  });

  it("returns nothing when the folder does not exist", async () => {
    expect(await scanWatchFolder(watchFolders(join(root, "nope")), new StabilityTracker())).toEqual([]);
  });
});

describe("archive", () => {
  let root: string;
  let folders: ReturnType<typeof watchFolders>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "watch-"));
    folders = watchFolders(root);
    await ensureWatchFolders(folders);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("moves a finished file to done", async () => {
    const path = join(root, "a.mp4");
    await writeFile(path, "x");
    await archive({ path, name: "a.mp4", theme: "", bytes: 1 }, folders, true);
    expect(await readdir(folders.done)).toEqual(["a.mp4"]);
    expect(await readdir(root)).not.toContain("a.mp4");
  });

  it("moves a failed file to failed, so it is not retried forever", async () => {
    const path = join(root, "b.mp4");
    await writeFile(path, "x");
    await archive({ path, name: "b.mp4", theme: "", bytes: 1 }, folders, false);
    expect(await readdir(folders.failed)).toEqual(["b.mp4"]);
  });

  it("never overwrites an earlier file of the same name", async () => {
    await mkdir(folders.done, { recursive: true });
    await writeFile(join(folders.done, "c.mp4"), "first");
    const path = join(root, "c.mp4");
    await writeFile(path, "second");
    await archive({ path, name: "c.mp4", theme: "", bytes: 1 }, folders, true);
    const done = (await readdir(folders.done)).sort();
    expect(done).toEqual(["c (1).mp4", "c.mp4"]);
  });
});
