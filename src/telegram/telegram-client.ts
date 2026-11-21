import { writeFile, copyFile, mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
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
/**
 * The ceiling when talking to a LOCAL Bot API server instead of Telegram's.
 * Running telegram-bot-api yourself raises getFile to 2000 MB, which is the
 * difference between "three minutes of phone video" and "a whole match".
 */
export const TELEGRAM_LOCAL_DOWNLOAD_LIMIT_BYTES = 2000 * 1024 * 1024;

/**
 * Base URL for the Bot API. Defaults to Telegram's own servers; point
 * TELEGRAM_API_BASE at a local telegram-bot-api instance (e.g.
 * http://localhost:8081) to lift the 20 MB download limit to 2 GB.
 */
export function telegramApiBase(): string {
  return (process.env.TELEGRAM_API_BASE?.trim() || "https://api.telegram.org").replace(/\/+$/u, "");
}

/** Whether we are talking to a self-hosted Bot API server rather than Telegram. */
export function usingLocalApiServer(): boolean {
  return telegramApiBase() !== "https://api.telegram.org";
}

/** The download ceiling that actually applies right now. */
export function downloadLimitBytes(): number {
  return usingLocalApiServer()
    ? TELEGRAM_LOCAL_DOWNLOAD_LIMIT_BYTES
    : TELEGRAM_BOT_DOWNLOAD_LIMIT_BYTES;
}

/** Telegram's ceiling for a video a bot SENDS. Lower than you would guess. */
export const TELEGRAM_BOT_UPLOAD_LIMIT_BYTES = 50 * 1024 * 1024;
/** A local Bot API server raises sending to the same 2 GB as downloading. */
export const TELEGRAM_LOCAL_UPLOAD_LIMIT_BYTES = 2000 * 1024 * 1024;

/**
 * The upload ceiling that actually applies right now.
 *
 * One number, read in two places that must agree: the compiler sizes a joined
 * reel to fit under it, and the delivery provider refuses anything over it. If
 * those two disagree — which they did, because the compiler read
 * TELEGRAM_API_BASE and the provider hardcoded Telegram's own host — a local
 * API server would make the compiler stop capping while the provider was still
 * sending to the endpoint that caps at fifty megabytes.
 */
export function uploadLimitBytes(): number {
  return usingLocalApiServer()
    ? TELEGRAM_LOCAL_UPLOAD_LIMIT_BYTES
    : TELEGRAM_BOT_UPLOAD_LIMIT_BYTES;
}

/** Absolute on POSIX (/var/lib/...) or Windows (C:\\...). */
function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(value);
}

/**
 * Translate a path the Bot API server reported into one this process can open.
 *
 * Set TELEGRAM_LOCAL_FILES_MAP to "<container path>=<host path>" when the
 * server's data volume is bind-mounted, e.g.
 *   TELEGRAM_LOCAL_FILES_MAP=/var/lib/telegram-bot-api=C:\\telegram-bot-api
 *
 * Returns undefined when no mapping applies and the path is not local, so the
 * caller downloads over HTTP instead.
 */
export function mapLocalFilePath(reported: string): string | undefined {
  const mapping = process.env.TELEGRAM_LOCAL_FILES_MAP?.trim();
  if (mapping) {
    const separator = mapping.indexOf("=");
    if (separator > 0) {
      const from = mapping.slice(0, separator).trim().replace(/[\\/]+$/u, "");
      const to = mapping.slice(separator + 1).trim().replace(/[\\/]+$/u, "");
      if (from !== "" && to !== "" && reported.startsWith(from)) {
        const rest = reported.slice(from.length).replace(/^[\\/]+/u, "");
        return join(to, rest);
      }
    }
  }
  // No mapping: only usable if the server shares this filesystem (server and
  // worker on the same host, not in a container).
  return existsSync(reported) ? reported : undefined;
}

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
    const api = telegramApiBase();
    this.base = `${api}/bot${token}`;
    this.fileBase = `${api}/file/bot${token}`;
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
   * Download a Telegram file by file_id to `destPath`. Enforces the applicable
   * size limit up front (getFile reports the size) so an oversize video fails
   * with a clear reason instead of a truncated file — 20 MB against Telegram's
   * own servers, 2 GB against a local Bot API server. Returns the byte count.
   *
   * A local server also serves files from a path on disk rather than over HTTP,
   * which is handled below.
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
    const limit = downloadLimitBytes();
    if (reportedSize !== undefined && reportedSize > limit) {
      const megabytes = (reportedSize / 1_048_576).toFixed(1);
      const capMb = Math.round(limit / 1_048_576);
      return {
        ok: false,
        error: usingLocalApiServer()
          ? `file is ${megabytes} MB — over the ${capMb} MB limit of your local Bot API server`
          : `file is ${megabytes} MB — over the ${capMb} MB bot limit. ` +
            "Run a local Bot API server (see scripts/telegram-local-api) to raise this to 2 GB, " +
            "or drop the file into the watch folder instead.",
      };
    }
    // A local Bot API server returns an ABSOLUTE PATH on disk rather than a URL
    // path, because the file never left the machine. Copying it beats fetching
    // it back over HTTP from ourselves — but only when this process can actually
    // see that path.
    //
    // It often cannot. The usual setup runs the server in Docker, so the path is
    // inside the CONTAINER (/var/lib/telegram-bot-api/...) while the worker runs
    // on the Windows host. TELEGRAM_LOCAL_FILES_MAP translates it when the
    // volume is bind-mounted; otherwise we fall through to the HTTP download,
    // which the local server also serves. A silent failure here would look like
    // the bot ignoring large videos.
    if (usingLocalApiServer() && isAbsolutePath(filePath)) {
      const localPath = mapLocalFilePath(filePath);
      if (localPath) {
        try {
          await mkdir(dirname(destPath), { recursive: true });
          await copyFile(localPath, destPath);
          const { size } = await stat(destPath);
          return { ok: true, bytes: size };
        } catch {
          // Unreadable from here — fall through to HTTP rather than give up.
        }
      }
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
