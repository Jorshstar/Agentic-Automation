import { describe, it, expect } from "vitest";
import type { AIKernel, AIGenerateRequest, AIGenerateResult } from "../ai/index.js";
import { parseCommand } from "./command-parser.js";

function stubKernel(output: string): AIKernel {
  return {
    async generate<TOutput = unknown>(request: AIGenerateRequest): Promise<AIGenerateResult<TOutput>> {
      return {
        output: output as unknown as TOutput,
        promptId: request.promptId,
        promptVersion: "v1",
        provider: "mock",
        model: "stub",
        usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10, costUsd: 0 },
        latencyMs: 1,
      };
    },
  };
}

function failingKernel(): AIKernel {
  return {
    async generate(): Promise<never> {
      throw new Error("api down");
    },
  };
}

describe("parseCommand", () => {
  it("bare status/help bypass the AI entirely", async () => {
    expect((await parseCommand(failingKernel(), "status")).action).toBe("status");
    expect((await parseCommand(failingKernel(), "/help")).action).toBe("help");
  });

  it("maps a create command with duration, voice, and style overrides", async () => {
    const parsed = await parseCommand(
      stubKernel(
        JSON.stringify({
          action: "create",
          instructions: "a scary video about an abandoned lighthouse",
          niche: "scary-stories",
          durationSeconds: 90,
          voice: "onyx",
          visualStyle: "dark stormy seas, lightning",
          musicMood: "none",
          exactTitle: false,
          reply: "",
        }),
      ),
      "whatever",
    );
    expect(parsed.action).toBe("create");
    expect(parsed.brief?.niche).toBe("scary-stories");
    expect(parsed.brief?.durationSeconds).toBe(90);
    expect(parsed.brief?.identity?.voice).toBe("onyx");
    expect(parsed.brief?.identity?.visualStyle).toContain("stormy");
    expect(parsed.brief?.identity?.musicMood).toBeUndefined();
  });

  it("drops hallucinated niches/voices instead of passing them through", async () => {
    const parsed = await parseCommand(
      stubKernel(
        JSON.stringify({
          action: "create",
          instructions: "x",
          niche: "true-crime",
          durationSeconds: 0,
          voice: "david-attenborough",
          visualStyle: "none",
          musicMood: "none",
          exactTitle: false,
          reply: "",
        }),
      ),
      "x",
    );
    expect(parsed.brief?.niche).toBeUndefined();
    expect(parsed.brief?.identity).toBeUndefined();
    expect(parsed.brief?.durationSeconds).toBeUndefined();
  });

  it("never silently reinterprets an out-of-range duration — flags it loudly", async () => {
    const parsed = await parseCommand(
      stubKernel(
        JSON.stringify({
          action: "create",
          instructions: "a 70 minute documentary about love",
          niche: "none",
          durationSeconds: 4200,
          voice: "none",
          visualStyle: "none",
          musicMood: "none",
          exactTitle: false,
          reply: "",
        }),
      ),
      "x",
    );
    expect(parsed.brief?.durationSeconds).toBeUndefined();
    expect(parsed.note).toContain("70 minutes");
    expect(parsed.note).toContain("maximum is 10 minutes");
  });

  it("falls back to create-with-raw-message when the parser call fails", async () => {
    const parsed = await parseCommand(failingKernel(), "make me something spooky");
    expect(parsed.action).toBe("create");
    expect(parsed.brief?.instructions).toBe("make me something spooky");
  });
});
