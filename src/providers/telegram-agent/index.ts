import type { AIKernel } from "../../ai/index.js";
import { textProviderOptions } from "../../ai/text-provider.js";
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
  /**
   * "chat" = keep talking; "build" = generate a short video; "clip" = clip a
   * shared link; "documentary" = make the next part of a narrated series.
   */
  readonly action: "chat" | "build" | "clip" | "documentary";
  /** A complete, self-contained brief for the video (only when action = "build"). */
  readonly brief: string;
  /** Whether to use the user's attached photos/videos in the build. */
  readonly useAssets: boolean;
  /**
   * The video link to clip (action = "clip"). Empty when the user uploaded the
   * video into the chat instead — the caller supplies that upload.
   */
  readonly url: string;
  /** What to clip: "goals", "funny", "key insights", or "auto" (action = "clip"). */
  readonly theme: string;
  /** How many clips to make (action = "clip"). */
  readonly count: number;
  /**
   * How the user wants the vertical frame laid out, in THEIR words — "full
   * screen", "show the whole video", "zoom in on him". Empty when they did not
   * say, which leaves the theme's default in place.
   */
  readonly layout: string;
  /**
   * Anything else they asked to be done TO the clip, in their own words — "add
   * captions", "remove the watermark", "cut the pauses". Empty when they asked
   * for none of it, which is the normal case: the clip comes back as footage.
   */
  readonly extras: string;
  /**
   * The documentary subject (action = "documentary").
   *
   * EMPTY is meaningful: it means continue the series already in progress,
   * which is what "do part 3" means when the subject was established earlier in
   * the conversation. Making the user retype a topic they already gave would be
   * worse than picking up the most recent series.
   */
  readonly documentaryTopic: string;
}

export class TelegramAgentProvider {
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
        // The chat brain is text work, so it follows whichever text endpoint
        // is configured. Without this it would use the prompt registry's
        // preferred provider and fail on an unfunded account, which the brain
        // swallows into its generic fallback reply.
        ...textProviderOptions("TELEGRAM_AGENT_MODEL"),
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
        layout: "",
        extras: "",
        documentaryTopic: "",
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
  const action: AgentDecision["action"] =
    rawAction === "build"
      ? "build"
      : rawAction === "clip"
        ? "clip"
        : rawAction === "documentary"
          ? "documentary"
          : "chat";
  const brief = typeof root["brief"] === "string" ? root["brief"].trim() : "";
  const useAssets = root["useAssets"] === true;
  const url = typeof root["url"] === "string" ? root["url"].trim() : "";
  const theme = typeof root["theme"] === "string" && root["theme"].trim() !== "" ? root["theme"].trim() : "auto";
  const count = typeof root["count"] === "number" && Number.isFinite(root["count"])
    ? Math.min(Math.max(Math.round(root["count"]), 1), 8)
    : 5;
  const layout = typeof root["layout"] === "string" ? root["layout"].trim().slice(0, 80) : "";
  const extras = typeof root["extras"] === "string" ? root["extras"].trim().slice(0, 120) : "";
  const documentaryTopic =
    typeof root["documentaryTopic"] === "string" ? root["documentaryTopic"].trim().slice(0, 160) : "";

  // Guards: never act without what the action needs.
  if (action === "build" && brief === "") {
    return { reply, action: "chat", brief: "", useAssets, url: "", theme, count, layout, extras, documentaryTopic };
  }
  // NOTE: a "clip" with an empty url is NOT downgraded here. The user may have
  // uploaded the video into the chat instead of sharing a link, and only the
  // caller knows whether an upload is attached. The caller does that check.
  return { reply, action, brief, useAssets, url, theme, count, layout, extras, documentaryTopic };
}

/**
 * Backwards-compatible alias. The brain is no longer Claude-specific — it runs
 * on whichever provider the request names — but the old name is still imported
 * by the ingest task.
 */
export { TelegramAgentProvider as ClaudeTelegramAgentProvider };
