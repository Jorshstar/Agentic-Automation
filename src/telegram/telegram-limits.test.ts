import { describe, it, expect, afterEach } from "vitest";
import {
  telegramApiBase,
  usingLocalApiServer,
  downloadLimitBytes,
  TELEGRAM_BOT_DOWNLOAD_LIMIT_BYTES,
  TELEGRAM_LOCAL_DOWNLOAD_LIMIT_BYTES,
} from "./telegram-client.js";

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
