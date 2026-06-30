import type { ScriptProvider } from "./script-provider.js";
import type {
  ScriptGenerationRequest,
  GeneratedScript,
  ImproveHookRequest,
  ImproveHookResult,
  GenerateCtaRequest,
  GenerateCtaResult,
  ValidateLengthRequest,
  LengthValidation,
} from "./types.js";

/**
 * MockScriptProvider — returns a FAKE but realistic script. No AI, no network,
 * no API key. Lets us build and test the ScriptAgent end-to-end before any real
 * model is wired in.
 */
export class MockScriptProvider implements ScriptProvider {
  readonly name = "mock-script-provider";

  async generateScript(request: ScriptGenerationRequest): Promise<GeneratedScript> {
    const topic = request.topic.trim();
    // Trim trailing punctuation so inline points read cleanly in sentences.
    const point = (index: number, fallback: string): string =>
      (request.keyPoints[index] ?? fallback).replace(/[.\s]+$/u, "");

    const hook = `Did you know about ${topic.toLowerCase()}? Stick around — this gets wild.`;
    const body = [
      hook,
      `Here's the gist: ${request.summary}`,
      `First, ${point(0, "the core fact is wilder than you'd expect")}.`,
      `What most people miss: ${point(1, "the cause is simpler than it looks")}.`,
      `Picture this — ${point(2, "you can spot it in everyday life")}.`,
      `And the myth? ${point(3, "it's not what you were told")}.`,
      `Bottom line: ${point(4, "remember this one thing")}.`,
    ].join(" ");

    const callToAction = "Follow for a new 60-second deep dive every single day.";
    const wordCount = body.trim().split(/\s+/u).length;
    const estimatedDurationSeconds = Math.max(1, Math.round(wordCount / 2.5));

    return {
      title: `${topic}: the 60-second truth`,
      hook,
      body,
      callToAction,
      estimatedDurationSeconds,
      wordCount,
      language: request.language ?? "en-US",
      tone: request.tone ?? "energetic-explainer",
      targetAudience: request.targetAudience ?? "curious short-form video viewers",
    };
  }

  async improveHook(request: ImproveHookRequest): Promise<ImproveHookResult> {
    return { hook: `${request.hook.trim()} You won't guess what happens next.` };
  }

  async generateCTA(_request: GenerateCtaRequest): Promise<GenerateCtaResult> {
    return { callToAction: "Follow for a new 60-second story every day." };
  }

  async validateLength(request: ValidateLengthRequest): Promise<LengthValidation> {
    const issues: string[] = [];
    if (request.wordCount < 60) {
      issues.push("Script is likely too short for a 60-second video.");
    }
    if (request.wordCount > 220) {
      issues.push("Script is likely too long for a 60-second video.");
    }
    return { valid: issues.length === 0, issues };
  }
}
