import { describe, it, expect } from "vitest";
import { subjectOf, isAbout } from "./research.js";

/**
 * A McDonald's documentary failed on sources about the world wars. Wikipedia's
 * full-text search scores every word in the query, so the headline
 * "HOW McDONALD'S CONQUERED THE WORLD" returned World War I — and the failure
 * surfaced four stages later as "every beat failed the fact check", which
 * points at the writer rather than at the search that caused it.
 */
describe("subjectOf", () => {
  it("strips the framing off the real example", () => {
    expect(subjectOf("HOW McDONALD'S CONQUERED THE WORLD")).toBe("McDONALD'S");
  });

  it("handles the common documentary phrasings", () => {
    expect(subjectOf("the rise and fall of Blockbuster")).toBe("Blockbuster");
    expect(subjectOf("the history of Instagram")).toBe("Instagram");
    expect(subjectOf("why the Concorde stopped flying")).toBe("the Concorde");
    expect(subjectOf("the untold story of Nokia")).toBe("Nokia");
  });

  it("leaves a plain subject alone", () => {
    expect(subjectOf("Nintendo")).toBe("Nintendo");
    expect(subjectOf("the Mary Celeste")).toBe("the Mary Celeste");
  });

  it("keeps the original rather than trimming to nothing", () => {
    // "the history of" with no subject after it must not become "".
    expect(subjectOf("the history of")).toBe("the history of");
  });
});

describe("isAbout", () => {
  it("rejects the articles that actually came back", () => {
    expect(isAbout(["World War I", "World War II", "Battle of Khunan"], "McDonald's")).toBe(false);
  });

  it("accepts the articles that should have", () => {
    expect(isAbout(["McDonald's", "Richard and Maurice McDonald"], "McDonald's")).toBe(true);
    expect(isAbout(["History of McDonald's", "Oldest McDonald's restaurant"], "McDonald's")).toBe(true);
  });

  it("matches across a plural or possessive", () => {
    expect(isAbout(["Richard and Maurice McDonald"], "McDonald's")).toBe(true);
  });

  it("does not match on a short shared prefix", () => {
    expect(isAbout(["Battle of Con Thien"], "Concorde")).toBe(false);
    expect(isAbout(["World War I"], "World of Warcraft")).toBe(false);
  });

  it("passes anything through when the subject has no distinctive word", () => {
    expect(isAbout(["World War I"], "the story of the world")).toBe(true);
  });
});
