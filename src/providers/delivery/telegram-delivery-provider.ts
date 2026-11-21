import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { withRetry } from "../../lib/retry.js";
import type { DeliveryProvider } from "./delivery-provider.js";
import { telegramApiBase, uploadLimitBytes } from "../../telegram/telegram-client.js";
import type {
  DeliveryContext,
  DeliveryRequest,
  DeliveryResult,
  DeliveryWarning,
} from "./types.js";

/**
 * TelegramDeliveryProvider — sends the finished video to a Telegram chat.
 *
 * Native `fetch` to the Telegram Bot API (no SDK). Reads TELEGRAM_BOT_TOKEN and
 * TELEGRAM_CHAT_ID from the environment; never logs them. Graceful: if it isn't
 * configured, it returns a `not-configured` warning rather than failing the run,
 * and a per-file send failure is a warning, not a crash.
 *
 * Bot uploads via sendVideo cap at 50 MB. A single short is a few MB, but a
 * JOINED reel is the sum of its clips and ran straight into that wall — so the
 * limit is read from one shared place now, not hardcoded here. Pointing
 * TELEGRAM_API_BASE at a local Bot API server moves both the endpoint and the
 * ceiling together; they used to move apart.
 */

const CAPTION_LIMIT = 1024;

/**
 * UPLOADS NEED A DEADLINE.
 *
 * A finished McDonald's documentary — scripted, fact-checked, narrated,
 * illustrated, composed, covered — sat for thirteen minutes inside this upload
 * and delivered nothing. fetch had no signal, so a stalled connection waits
 * forever, and the worker was neither working nor erroring with nothing in the
 * log after the last step it completed. That is the hardest kind of down to
 * notice, and it was the last gate in front of the user.
 *
 * The deadline scales with the file because a flat one is wrong both ways: 30
 * seconds kills a legitimate 40 MB upload on a slow line, and 20 minutes is no
 * deadline at all for a text message. Twenty seconds per megabyte is roughly a
 * 0.4 Mbps uplink — slower than any connection that could have produced the
 * video in the first place.
 */
const TEXT_TIMEOUT_MS = 30_000;
const UPLOAD_BASE_MS = 60_000;
const UPLOAD_MS_PER_MB = 20_000;
const UPLOAD_MAX_MS = 20 * 60_000;

export function uploadTimeoutMs(bytes: number): number {
  const scaled = UPLOAD_BASE_MS + (Math.max(0, bytes) / (1024 * 1024)) * UPLOAD_MS_PER_MB;
  return Math.min(UPLOAD_MAX_MS, Math.round(scaled));
}

const DEFAULT_DELIVERY_CONTEXT: DeliveryContext = { sendDocuments: true };

export class TelegramDeliveryProvider implements DeliveryProvider {
  readonly name = "telegram-delivery-provider";

  constructor(private readonly context: DeliveryContext = DEFAULT_DELIVERY_CONTEXT) {}

  /**
   * Send a plain text message (used for failure alerts and QA blocks). Graceful:
   * returns false (never throws) if the bot isn't configured or the send fails.
   */
  async notify(text: string): Promise<boolean> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
      return false;
    }
    return sendMessage(`${telegramApiBase()}/bot${token}`, chatId, text, []);
  }

  async deliver(request: DeliveryRequest): Promise<DeliveryResult> {
    const ctx: DeliveryContext = { ...this.context, ...request.context };
    const warnings: DeliveryWarning[] = [];

    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
      warnings.push({
        code: "not-configured",
        message: "TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set; skipping delivery.",
      });
      return { delivered: false, provider: this.name, videoSent: false, documentsSent: 0, warnings };
    }

    const base = `${telegramApiBase()}/bot${token}`;
    let videoSent = false;

    // --- Send the video (with the caption) ---
    const size = await fileSize(request.videoPath);
    if (request.videoPath === "" || size === 0) {
      warnings.push({ code: "missing-file", message: `No video to send at "${request.videoPath}".` });
    } else if (size > uploadLimitBytes()) {
      const limitMb = Math.round(uploadLimitBytes() / 1024 / 1024);
      warnings.push({
        code: "too-large",
        message: `Video is ${(size / 1024 / 1024).toFixed(1)} MB (over the ${limitMb} MB upload limit); sending caption only.`,
      });
      await sendMessage(base, chatId, request.caption, warnings);
    } else {
      videoSent = await sendVideo(base, chatId, request.videoPath, request.caption, warnings);
    }

    // --- Optionally attach sidecar documents ---
    let documentsSent = 0;
    if (ctx.sendDocuments && request.documents) {
      for (const doc of request.documents) {
        if ((await fileSize(doc)) > 0 && (await sendDocument(base, chatId, doc, warnings))) {
          documentsSent += 1;
        }
      }
    }

    return {
      delivered: videoSent,
      provider: this.name,
      videoSent,
      documentsSent,
      warnings,
    };
  }
}

async function sendVideo(
  base: string,
  chatId: string,
  videoPath: string,
  caption: string,
  warnings: DeliveryWarning[],
): Promise<boolean> {
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("caption", caption.slice(0, CAPTION_LIMIT));
  form.append("supports_streaming", "true");
  form.append("video", await fileBlob(videoPath, "video/mp4"), basename(videoPath));
  return post(
    `${base}/sendVideo`,
    form,
    "sendVideo",
    warnings,
    uploadTimeoutMs(await fileSize(videoPath)),
    2,
  );
}

async function sendDocument(
  base: string,
  chatId: string,
  docPath: string,
  warnings: DeliveryWarning[],
): Promise<boolean> {
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("document", await fileBlob(docPath, "application/octet-stream"), basename(docPath));
  return post(
    `${base}/sendDocument`,
    form,
    "sendDocument",
    warnings,
    uploadTimeoutMs(await fileSize(docPath)),
    2,
  );
}

async function sendMessage(
  base: string,
  chatId: string,
  text: string,
  warnings: DeliveryWarning[],
): Promise<boolean> {
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("text", text.slice(0, 4096));
  return post(`${base}/sendMessage`, form, "sendMessage", warnings);
}

async function post(
  url: string,
  form: FormData,
  label: string,
  warnings: DeliveryWarning[],
  timeoutMs = TEXT_TIMEOUT_MS,
  attempts = 3,
): Promise<boolean> {
  try {
    // Network errors and transient statuses (429/5xx) retry with backoff;
    // permanent 4xx responses fall through to a warning without retrying.
    const response = await withRetry(
      async () => {
        const res = await fetch(url, {
          method: "POST",
          body: form,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.status === 429 || res.status >= 500) {
          throw new Error(`Telegram ${label} transient failure (${res.status}).`);
        }
        return res;
      },
      // Fewer attempts on a big upload: three full timeouts on a broken link is
      // an hour of waiting to learn the same thing twice over.
      { attempts },
    );
    if (!response.ok) {
      const detail = (await safeText(response)).slice(0, 300);
      warnings.push({ code: "send-failed", message: `Telegram ${label} failed (${response.status}). ${detail}` });
      return false;
    }
    return true;
  } catch (error) {
    warnings.push({ code: "send-failed", message: `Telegram ${label} error: ${error instanceof Error ? error.message : String(error)}` });
    return false;
  }
}

async function fileBlob(path: string, type: string): Promise<Blob> {
  const buffer = await readFile(path);
  return new Blob([buffer], { type });
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
