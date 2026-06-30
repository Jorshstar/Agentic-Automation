/**
 * Script provider types — the request/response shapes a script provider speaks.
 * Shaped to resemble what a real AI provider would return later.
 */

/** What the agent asks the provider to turn into a script. */
export interface ScriptGenerationRequest {
  readonly topic: string;
  readonly angle?: string;
  /** Research summary to base the script on. */
  readonly summary: string;
  /** The key facts the script should cover. */
  readonly keyPoints: readonly string[];
  readonly keywords?: readonly string[];
  /** Desired video length in seconds (e.g. 60). */
  readonly targetDurationSeconds?: number;
  readonly tone?: string;
  readonly language?: string;
  readonly targetAudience?: string;
}

/** A full generated script, mirroring a real provider's richer output. */
export interface GeneratedScript {
  readonly title: string;
  readonly hook: string;
  readonly body: string;
  readonly callToAction: string;
  readonly estimatedDurationSeconds: number;
  readonly wordCount: number;
  readonly language: string;
  readonly tone: string;
  readonly targetAudience: string;
}

export interface ImproveHookRequest {
  readonly hook: string;
  readonly topic?: string;
}
export interface ImproveHookResult {
  readonly hook: string;
}

export interface GenerateCtaRequest {
  readonly topic?: string;
  readonly platform?: string;
}
export interface GenerateCtaResult {
  readonly callToAction: string;
}

export interface ValidateLengthRequest {
  readonly wordCount: number;
  readonly targetDurationSeconds?: number;
}
export interface LengthValidation {
  readonly valid: boolean;
  readonly issues: readonly string[];
}
