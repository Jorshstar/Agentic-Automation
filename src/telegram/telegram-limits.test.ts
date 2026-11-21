import { describe, it, expect, afterEach } from "vitest";
import {
  telegramApiBase,
  usingLocalApiServer,
  downloadLimitBytes,
  TELEGRAM_BOT_DOWNLOAD_LIMIT_BYTES,
  TELEGRAM_LOCAL_DOWNLOAD_LIMIT_BYTES,
  uploadLimitBytes,
  TELEGRAM_BOT_UPLOAD_LIMIT_BYTES,
  TELEGRAM_LOCAL_UPLOAD_LIMIT_BYTES,
} from "./telegram-client.js";
import { uploadTimeoutMs } from "../providers/delivery/telegram-delivery-provider.js";

afterEach(() => {
  delete process.env.TELEGRAM_API_BASE;
});

describe("telegramApiBase", () => {
  it("defaults to Telegram's own servers", () => {
    expect(telegramApiBase()).toBe("https://api.telegram.org");
    expect(usingLocalApiServer()).toBe(false);
  });

  it("uses a local server when one is configured", () => {
    process.env.TELEGRAM_API_BASE = "http://localhost:8081";
    expect(telegramApiBase()).toBe("http://localhost:8081");
    expect(usingLocalApiServer()).toBe(true);
  });

  it("tolerates a trailing slash", () => {
    process.env.TELEGRAM_API_BASE = "http://localhost:8081/";
    expect(telegramApiBase()).toBe("http://localhost:8081");
  });

  it("treats the official URL as not local, even if set explicitly", () => {
    process.env.TELEGRAM_API_BASE = "https://api.telegram.org";
    expect(usingLocalApiServer()).toBe(false);
    expect(downloadLimitBytes()).toBe(TELEGRAM_BOT_DOWNLOAD_LIMIT_BYTES);
  });
});

describe("downloadLimitBytes", () => {
  it("is 20 MB against Telegram", () => {
    expect(downloadLimitBytes()).toBe(20 * 1024 * 1024);
  });

  it("is 2 GB against a local server", () => {
    process.env.TELEGRAM_API_BASE = "http://localhost:8081";
    expect(downloadLimitBytes()).toBe(TELEGRAM_LOCAL_DOWNLOAD_LIMIT_BYTES);
    expect(downloadLimitBytes()).toBeGreaterThan(TELEGRAM_BOT_DOWNLOAD_LIMIT_BYTES * 90);
  });
});

/**
 * The compiler and the delivery provider must read ONE limit. They used to
 * read two: the compiler looked at TELEGRAM_API_BASE and the provider
 * hardcoded Telegram's own host, so pointing at a local Bot API server would
 * have stopped the compiler capping while the provider still sent to the
 * endpoint that caps at fifty megabytes.
 */
describe("uploadLimitBytes", () => {
    it("is Telegram's 50 MB by default", () => {
    delete process.env.TELEGRAM_API_BASE;
    expect(uploadLimitBytes()).toBe(TELEGRAM_BOT_UPLOAD_LIMIT_BYTES);
  });

  it("rises to 2 GB against a local Bot API server", () => {
    process.env.TELEGRAM_API_BASE = "http://localhost:8081";
    expect(uploadLimitBytes()).toBe(TELEGRAM_LOCAL_UPLOAD_LIMIT_BYTES);
  });

  it("stays at 50 MB when the base is Telegram's own host", () => {
    process.env.TELEGRAM_API_BASE = "https://api.telegram.org";
    expect(uploadLimitBytes()).toBe(TELEGRAM_BOT_UPLOAD_LIMIT_BYTES);
  });
});

/**
 * A 23 MB documentary sat thirteen minutes inside an upload with no deadline
 * and delivered nothing. The deadline scales with the file because a flat one
 * is wrong in both directions.
 */
describe("uploadTimeoutMs", () => {
  it("gives a small file a short deadline", () => {
    expect(uploadTimeoutMs(1 * 1024 * 1024)).toBeLessThan(2 * 60_000);
  });

  it("would have tripped on the 23 MB documentary inside thirteen minutes", () => {
    const timeout = uploadTimeoutMs(23 * 1024 * 1024);
    expect(timeout).toBeLessThan(13 * 60_000);
    // ...but not so short that a slow line loses a legitimate upload.
    expect(timeout).toBeGreaterThan(5 * 60_000);
  });

  it("caps so a broken link cannot wait forever", () => {
    expect(uploadTimeoutMs(5_000 * 1024 * 1024)).toBe(20 * 60_000);
  });

  it("is safe on a zero or negative size", () => {
    expect(uploadTimeoutMs(0)).toBe(60_000);
    expect(uploadTimeoutMs(-1)).toBe(60_000);
  });
});
