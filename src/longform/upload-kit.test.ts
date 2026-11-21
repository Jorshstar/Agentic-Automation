import { describe, it, expect } from "vitest";
import { uploadKit } from "./upload-kit.js";

const fields = (over: Partial<Parameters<typeof uploadKit>[0]> = {}) => ({
  youtubeTitle: "How McDonald's Took Over the World 🌍 | The Fast Food Revolution Begins",
  youtubeDescription: "The McDonald brothers opened a drive-in in San Bernardino…",
  tags: ["mcdonalds", "fast food", "documentary"],
  ...over,
});

describe("uploadKit", () => {
  it("lays out all three parts", () => {
    const kit = uploadKit(fields());
    expect(kit).toContain("📝 TITLE");
    expect(kit).toContain("How McDonald's Took Over the World");
    expect(kit).toContain("📄 DESCRIPTION");
    expect(kit).toContain("🏷 TAGS");
    expect(kit).toContain("mcdonalds, fast food, documentary");
  });

  it("sends nothing at all when there is nothing to send", () => {
    // Better to skip the message than post an empty heading.
    expect(uploadKit({ youtubeTitle: "", youtubeDescription: "", tags: [] })).toBe("");
    expect(uploadKit({ youtubeTitle: "  ", youtubeDescription: "\n", tags: ["  "] })).toBe("");
  });

  it("omits a section that is missing rather than leaving a bare heading", () => {
    const kit = uploadKit(fields({ youtubeDescription: "" }));
    expect(kit).not.toContain("DESCRIPTION");
    expect(kit).toContain("📝 TITLE");
    expect(kit).toContain("🏷 TAGS");
  });

  /**
   * Telegram refuses a message over 4096 characters. A kit that is silently
   * dropped for being too long is the same failure this module exists to fix.
   */
  it("fits inside a Telegram message, trimming only the description", () => {
    const kit = uploadKit(fields({ youtubeDescription: "word ".repeat(2000) }));
    expect(kit.length).toBeLessThan(4096);
    // The parts that are useless when clipped survive whole.
    expect(kit).toContain("The Fast Food Revolution Begins");
    expect(kit).toContain("mcdonalds, fast food, documentary");
    expect(kit).toContain("…");
  });

  it("caps a runaway tag list", () => {
    const kit = uploadKit(fields({ tags: Array.from({ length: 60 }, (_, i) => `tag${i}`) }));
    expect(kit).toContain("tag19");
    expect(kit).not.toContain("tag20");
  });
});
