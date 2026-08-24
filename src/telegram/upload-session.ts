import { withRetry } from "../lib/retry.js";

/**
 * State the always-on Telegram agent keeps between its 1-minute polls:
 *
 *   - the getUpdates OFFSET, so no message is missed or replayed across runs, and
 *   - a per-chat CONVERSATION: the running chat history plus any photos/videos the
 *     user has OPTIONALLY attached. The agent chats, brainstorms and asks
 *     questions across turns, so it needs the history; assets are extras it may
 *     weave into a video if the user wants.
 *
 * Backed by Upstash Redis (REST) in the cloud — the SAME store the daily job
 * uses (UPSTASH_REDIS_REST_URL + _TOKEN). With no Upstash it falls back to an
 * in-process map (enough for a single local test).
 */

export interface PendingAsset {
  readonly fileId: string;
  readonly kind: "photo" | "video";
}

export interface ChatMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
}

export interface ChatSession {
  /** Running conversation, oldest first (capped to the most recent turns). */
  readonly messages: readonly ChatMessage[];
  /** Optionally-attached photos/videos, in the order they arrived. */
  readonly assets: readonly PendingAsset[];
  readonly updatedAt: number;
}

const OFFSET_KEY = "content-studio:tg:offset";
const SESSION_PREFIX = "content-studio:tg:session:";
/** A conversation expires after 6 hours of silence. */
const SESSION_TTL_SECONDS = 6 * 60 * 60;
/** Keep only the most recent turns so prompt tokens stay bounded. */
const MAX_MESSAGES = 24;

export const EMPTY_SESSION: ChatSession = { messages: [], assets: [], updatedAt: 0 };

/** Append a message and trim to the last {@link MAX_MESSAGES}. */
export function withMessage(session: ChatSession, message: ChatMessage): ChatSession {
  const messages = [...session.messages, message].slice(-MAX_MESSAGES);
  return { ...session, messages, updatedAt: Date.now() };
}

export interface ConversationStore {
  getOffset(): Promise<number>;
  setOffset(offset: number): Promise<void>;
  getSession(chatId: string): Promise<ChatSession>;
  setSession(chatId: string, session: ChatSession): Promise<void>;
  clearSession(chatId: string): Promise<void>;
}

/** Upstash if configured (cloud-safe, survives between cron runs), else in-memory. */
export function createConversationStore(): ConversationStore {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    return new UpstashConversationStore(url, token);
  }
  return new MemoryConversationStore();
}

/** In-process fallback. Fine for one local test; NOT shared across cloud runs. */
export class MemoryConversationStore implements ConversationStore {
  private offset = 0;
  private readonly sessions = new Map<string, ChatSession>();

  async getOffset(): Promise<number> {
    return this.offset;
  }
  async setOffset(offset: number): Promise<void> {
    this.offset = offset;
  }
  async getSession(chatId: string): Promise<ChatSession> {
    return this.sessions.get(chatId) ?? EMPTY_SESSION;
  }
  async setSession(chatId: string, session: ChatSession): Promise<void> {
    this.sessions.set(chatId, session);
  }
  async clearSession(chatId: string): Promise<void> {
    this.sessions.delete(chatId);
  }
}

/** Upstash Redis (REST) backend. */
export class UpstashConversationStore implements ConversationStore {
  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  async getOffset(): Promise<number> {
    const result = await this.command(["GET", OFFSET_KEY]);
    const n = typeof result === "string" ? Number.parseInt(result, 10) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  async setOffset(offset: number): Promise<void> {
    await this.command(["SET", OFFSET_KEY, String(offset)]);
  }

  async getSession(chatId: string): Promise<ChatSession> {
    const result = await this.command(["GET", SESSION_PREFIX + chatId]);
    if (typeof result !== "string") {
      return EMPTY_SESSION;
    }
    try {
      const parsed = JSON.parse(result) as ChatSession;
      return {
        messages: Array.isArray(parsed.messages) ? parsed.messages : [],
        assets: Array.isArray(parsed.assets) ? parsed.assets : [],
        updatedAt: parsed.updatedAt ?? 0,
      };
    } catch {
      return EMPTY_SESSION;
    }
  }

  async setSession(chatId: string, session: ChatSession): Promise<void> {
    await this.command(["SET", SESSION_PREFIX + chatId, JSON.stringify(session), "EX", String(SESSION_TTL_SECONDS)]);
  }

  async clearSession(chatId: string): Promise<void> {
    await this.command(["DEL", SESSION_PREFIX + chatId]);
  }

  private async command(command: readonly string[]): Promise<unknown> {
    const response = await withRetry(async () => {
      const res = await fetch(this.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(command),
      });
      if (!res.ok) {
        throw new Error(`Upstash command failed (${res.status})`);
      }
      return res;
    });
    const json = (await response.json()) as { result?: unknown };
    return json.result;
  }
}
