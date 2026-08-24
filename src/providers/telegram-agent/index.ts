import type { AIKernel } from "../../ai/index.js";
import { createClaudeAIKernel } from "../../ai/index.js";
import type { ChatMessage } from "../../telegram/upload-session.js";

/**
 * The Telegram creative partner. Given the running conversation (and how many
 * photos/videos the user has optionally attached), it produces ONE reply and
 * decides whether the user has confirmed they want a video generated now.
 *
 * It is a normal chat brain first — it brainstorms, asks questions, riffs — and
 * only returns action "build" once the user clearly says "make it / go / yes".
 * Photos/videos are always optional; a video can be built from words alone.
 */

const SYSTEM_PROMPT_ID = "telegram-agent.system";
const USER_PROMPT_ID = "telegram-agent.user";

export interface AgentDecision {
  /** The message to send back to the user. */
  readonly reply: string;
  /** "chat" = keep talking; "build" = generate a video; "clip" = clip a shared link. */
  readonly action: "chat" | "build" | "clip";
  /** A complete, self-contained brief for the video (only when action = "build"). */
  readonly brief: string;
  /** Whether to use the user's attached photos/videos in the build. */
  readonly useAssets: boolean;
  /** The video link to clip (only when action = "clip"). */
  readonly url: string;
  /** What to clip: "goals", "funny", "key insights", or "auto" (action = "clip"). */
  readonly theme: string;
  /** How many clips to make (action = "clip"). */
  readonly count: number;
}

export class ClaudeTelegramAgentProvider {
  private readonly kernel: AIKernel;

  constructor(kernel?: AIKernel) {
    this.kernel = kernel ?? createClaudeAIKernel();
  }

  async respond(input: { messages: readonly ChatMessage[]; assetCount: number }): Promise<AgentDecision> {
    const transcript = input.messages
      .map((m) => `${m.role === "user" ? "User" : "You"}: ${m.text}`)
      .join("\n");

    try {
      const generated = await this.kernel.generate({
        promptId: USER_PROMPT_ID,
        systemPromptId: SYSTEM_PROMPT_ID,
        variables: {
          conversation: transcript,
          assetCount: input.assetCount,
        },
        expectedOutput: { format: "json", description: "a chat reply and a build decision" },
        maxTokens: 700,
      });
      return parseDecision(generated.output);
    } catch {
      // Never leave the user hanging — fall back to a plain chat nudge.
      return {
        reply: "I'm here — tell me what you'd like to make, or just think out loud with me.",
        action: "chat",
        brief: "",
        useAssets: false,
        url: "",
        theme: "auto",
        count: 5,
      };
    }
  }
}

/** The kernel returns JSON output as a string — parse it (tolerating fences). */
function coerceObject(output: unknown): Record<string, unknown> {
  if (output && typeof output === "object") {
    return output as Record<string, unknown>;
  }
  if (typeof output === "string") {
    const cleaned = output.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    try {
      const parsed = JSON.parse(cleaned);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

/** Coerce the model's JSON into a safe {@link AgentDecision}. */
function parseDecision(output: unknown): AgentDecision {
  const root = coerceObject(output);
  const reply = typeof root["reply"] === "string" && root["reply"].trim() !== ""
    ? root["reply"].trim()
    : "Tell me a bit more about what you'd like to create.";
  const rawAction = root["action"];
  const action: AgentDecision["action"] = rawAction === "build" ? "build" : rawAction === "clip" ? "clip" : "chat";
  const brief = typeof root["brief"] === "string" ? root["brief"].trim() : "";
  const useAssets = root["useAssets"] === true;
  const url = typeof root["url"] === "string" ? root["url"].trim() : "";
  const theme = typeof root["theme"] === "string" && root["theme"].trim() !== "" ? root["theme"].trim() : "auto";
  const count = typeof root["count"] === "number" && Number.isFinite(root["count"])
    ? Math.min(Math.max(Math.round(root["count"]), 1), 8)
    : 5;

  // Guards: never act without what the action needs.
  if (action === "build" && brief === "") {
    return { reply, action: "chat", brief: "", useAssets, url: "", theme, count };
  }
  if (action === "clip" && url === "") {
    return { reply, action: "chat", brief: "", useAssets, url: "", theme, count };
  }
  return { reply, action, brief, useAssets, url, theme, count };
}
