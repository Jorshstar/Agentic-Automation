import { withRetry } from "../lib/retry.js";
import { ConfigurationError } from "../lib/errors.js";

/**
 * Thin Telegram Bot API client for the COMMAND direction (reading your messages,
 * replying, live-editing a progress message). Native `fetch`, no SDK. Delivery
 * of finished videos stays in TelegramDeliveryProvider — this client is only the
 * conversational layer. Never logs the token.
 */

export interface IncomingMessage {
  readonly updateId: number;
  readonly chatId: string;
  readonly text: string;
  readonly from: string;
}

export class TelegramClient {
  private readonly base: string;
  /** The single chat allowed to command the studio. */
  readonly ownerChatId: string;

  constructor() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
      throw new ConfigurationError("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set to run the listener.");
    }
    this.base = `https://api.telegram.org/bot${token}`;
    this.ownerChatId = chatId;
  }

  /**
   * Long-poll for new messages (blocks up to `timeoutSeconds` server-side).
   * Returns text messages only, oldest first. Never throws — a poll failure
   * returns [] and the loop just polls again.
   */
  async poll(offset: number, timeoutSeconds = 50): Promise<readonly IncomingMessage[]> {
    try {
      const response = await fetch(
        `${this.base}/getUpdates?offset=${offset}&timeout=${timeoutSeconds}&allowed_updates=%5B%22message%22%5D`,
        { signal: AbortSignal.timeout((timeoutSeconds + 10) * 1000) },
      );
      if (!response.ok) {
        return [];
      }
      const json = (await response.json()) as {
        result?: readonly {
          update_id: number;
          message?: { chat?: { id?: number }; text?: string; from?: { first_name?: string } };
        }[];
      };
      const updates = json.result ?? [];
      const messages: IncomingMessage[] = [];
      for (const update of updates) {
        const text = update.message?.text;
        const chatId = update.message?.chat?.id;
        if (typeof text === "string" && chatId !== undefined) {
          messages.push({
            updateId: update.update_id,
            chatId: String(chatId),
            text,
            from: update.message?.from?.first_name ?? "unknown",
          });
        } else {
          // Non-text update — still consume it so the offset advances.
          messages.push({ updateId: update.update_id, chatId: "", text: "", from: "" });
        }
      }
      return messages;
    } catch {
      return [];
    }
  }

  /** Discard any backlog so a restart never replays old commands. */
  async dropBacklog(): Promise<number> {
    const backlog = await this.poll(0, 0);
    const last = backlog[backlog.length - 1];
    return last ? last.updateId + 1 : 0;
  }

  /** Send a message; returns its message_id (for later edits), or undefined. */
  async send(text: string): Promise<number | undefined> {
    try {
      const result = await withRetry(() => this.call("sendMessage", { chat_id: this.ownerChatId, text: text.slice(0, 4096) }), { attempts: 2 });
      const messageId = (result as { message_id?: number } | undefined)?.message_id;
      return typeof messageId === "number" ? messageId : undefined;
    } catch {
      return undefined;
    }
  }

  /** Edit a previously sent message (live progress). Falls back silently. */
  async edit(messageId: number, text: string): Promise<void> {
    try {
      await this.call("editMessageText", {
        chat_id: this.ownerChatId,
        message_id: messageId,
        text: text.slice(0, 4096),
      });
    } catch {
      // Edits are cosmetic — never let them break the run.
    }
  }

  private async call(method: string, body: Record<string, unknown>): Promise<unknown> {
    const response = await fetch(`${this.base}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`Telegram ${method} failed (${response.status})`);
    }
    const json = (await response.json()) as { result?: unknown };
    return json.result;
  }
}
