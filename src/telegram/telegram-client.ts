import { writeFile } from "node:fs/promises";
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

/** One uploaded file inside a message (photo, video, or image/video document). */
export interface IncomingMedia {
  /** Telegram file_id — stable; download it later via {@link TelegramClient.download}. */
  readonly fileId: string;
  readonly kind: "photo" | "video";
  /** Bytes, when Telegram reports it (used to reject files over the 20 MB bot limit). */
  readonly fileSize?: number;
}

/**
 * A raw update with everything the always-on ingest needs: the text OR caption,
 * any attached media, and the album id so multi-photo sends group together.
 */
export interface RawUpdate {
  readonly updateId: number;
  readonly chatId: string;
  /** message.text, or the caption when the message carries media. "" if neither. */
  readonly text: string;
  readonly from: string;
  readonly media: readonly IncomingMedia[];
  /** Telegram media_group_id — same value across the photos of one album send. */
  readonly mediaGroupId?: string;
}

/** Telegram's 20 MB ceiling for files a bot may download via getFile. */
export const TELEGRAM_BOT_DOWNLOAD_LIMIT_BYTES = 20 * 1024 * 1024;

export class TelegramClient {
  private readonly base: string;
  /** File-download base: https://api.telegram.org/file/bot<token> (never logged). */
  private readonly fileBase: string;
  /** The single chat allowed to command the studio. */
  readonly ownerChatId: string;

  constructor() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
      throw new ConfigurationError("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set to run the listener.");
    }
    this.base = `https://api.telegram.org/bot${token}`;
    this.fileBase = `https://api.telegram.org/file/bot${token}`;
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

  /**
   * Long-poll and return RAW updates — text/caption AND any attached media
   * (photos, videos, image/video documents) plus the album id. This is what the
   * always-on cloud ingest reads. Never throws — a failure returns [].
   *
   * `timeoutSeconds = 0` for a quick drain (the 1-min cron poller), higher for a
   * blocking long-poll.
   */
  async pollRaw(offset: number, timeoutSeconds = 0): Promise<readonly RawUpdate[]> {
    try {
      const response = await fetch(
        `${this.base}/getUpdates?offset=${offset}&timeout=${timeoutSeconds}&allowed_updates=%5B%22message%22%5D`,
        { signal: AbortSignal.timeout((timeoutSeconds + 15) * 1000) },
      );
      if (!response.ok) {
        return [];
      }
      const json = (await response.json()) as { result?: readonly RawTelegramUpdate[] };
      const updates: RawUpdate[] = [];
      for (const update of json.result ?? []) {
        const message = update.message;
        const chatId = message?.chat?.id;
        if (chatId === undefined) {
          // Non-message update — still surface the id so the offset advances.
          updates.push({ updateId: update.update_id, chatId: "", text: "", from: "", media: [] });
          continue;
        }
        updates.push({
          updateId: update.update_id,
          chatId: String(chatId),
          text: message?.text ?? message?.caption ?? "",
          from: message?.from?.first_name ?? "unknown",
          media: extractMedia(message ?? {}),
          ...(message?.media_group_id ? { mediaGroupId: message.media_group_id } : {}),
        });
      }
      return updates;
    } catch {
      return [];
    }
  }

  /**
   * Download a Telegram file by file_id to `destPath`. Enforces the 20 MB bot
   * limit up front (getFile reports the size) so oversize videos fail with a
   * clear reason instead of a truncated file. Returns the byte count on success.
   */
  async download(fileId: string, destPath: string): Promise<{ ok: true; bytes: number } | { ok: false; error: string }> {
    let filePath: string;
    let reportedSize: number | undefined;
    try {
      const info = (await this.call("getFile", { file_id: fileId })) as { file_path?: string; file_size?: number } | undefined;
      if (!info?.file_path) {
        return { ok: false, error: "getFile returned no file_path" };
      }
      filePath = info.file_path;
      reportedSize = info.file_size;
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    if (reportedSize !== undefined && reportedSize > TELEGRAM_BOT_DOWNLOAD_LIMIT_BYTES) {
      return { ok: false, error: `file is ${(reportedSize / 1_048_576).toFixed(1)} MB — over the 20 MB bot limit` };
    }
    try {
      const res = await fetch(`${this.fileBase}/${filePath}`, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) {
        return { ok: false, error: `file download failed (${res.status})` };
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength > TELEGRAM_BOT_DOWNLOAD_LIMIT_BYTES) {
        return { ok: false, error: "file exceeds the 20 MB bot limit" };
      }
      await writeFile(destPath, bytes);
      return { ok: true, bytes: bytes.byteLength };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
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

/* --------------------------- raw update parsing --------------------------- */

interface TelegramPhotoSize {
  readonly file_id: string;
  readonly file_size?: number;
  readonly width?: number;
}
interface TelegramFile {
  readonly file_id: string;
  readonly file_size?: number;
  readonly mime_type?: string;
}
interface RawTelegramMessage {
  readonly chat?: { id?: number };
  readonly from?: { first_name?: string };
  readonly text?: string;
  readonly caption?: string;
  readonly media_group_id?: string;
  readonly photo?: readonly TelegramPhotoSize[];
  readonly video?: TelegramFile;
  readonly document?: TelegramFile;
}
interface RawTelegramUpdate {
  readonly update_id: number;
  readonly message?: RawTelegramMessage;
}

/**
 * Pull downloadable media out of a message. Photos arrive as multiple sizes —
 * take the largest (last). Videos and image/video documents are taken as-is.
 * A document with any other mime type is ignored (we only build from media).
 */
function extractMedia(message: RawTelegramMessage): IncomingMedia[] {
  const media: IncomingMedia[] = [];
  if (message.photo && message.photo.length > 0) {
    const largest = message.photo[message.photo.length - 1];
    if (largest) {
      media.push({ fileId: largest.file_id, kind: "photo", ...(largest.file_size !== undefined ? { fileSize: largest.file_size } : {}) });
    }
  }
  if (message.video?.file_id) {
    media.push({ fileId: message.video.file_id, kind: "video", ...(message.video.file_size !== undefined ? { fileSize: message.video.file_size } : {}) });
  }
  const doc = message.document;
  if (doc?.file_id && doc.mime_type) {
    if (doc.mime_type.startsWith("image/")) {
      media.push({ fileId: doc.file_id, kind: "photo", ...(doc.file_size !== undefined ? { fileSize: doc.file_size } : {}) });
    } else if (doc.mime_type.startsWith("video/")) {
      media.push({ fileId: doc.file_id, kind: "video", ...(doc.file_size !== undefined ? { fileSize: doc.file_size } : {}) });
    }
  }
  return media;
}
