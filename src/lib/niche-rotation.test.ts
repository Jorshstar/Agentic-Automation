import { describe, it, expect } from "vitest";
import { getNicheForDate } from "./niche-rotation.js";
import { NICHE_ROTATION } from "../config/niches.js";

describe("niche rotation (daily)", () => {
  it("advances to a DIFFERENT niche every consecutive day", () => {
    const dates = ["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04"];
    const niches = dates.map(getNicheForDate);
    expect(new Set(niches).size).toBe(4); // four days → four different niches
  });

  it("cycles back after covering every niche", () => {
    expect(getNicheForDate("2026-07-01")).toBe(getNicheForDate("2026-07-05"));
  });

  it("is deterministic (same date always gives the same niche)", () => {
    expect(getNicheForDate("2026-03-15")).toBe(getNicheForDate("2026-03-15"));
  });

  it("only ever returns configured niches", () => {
    const known = new Set<string>(NICHE_ROTATION.map((n) => n.id));
    for (let day = 1; day <= 28; day += 1) {
      const date = `2026-02-${String(day).padStart(2, "0")}`;
      expect(known.has(getNicheForDate(date))).toBe(true);
    }
  });

  it("rejects an invalid date", () => {
    expect(() => getNicheForDate("not-a-date")).toThrow();
  });
});
