import { describe, it, expect } from "vitest";
import { withRetry } from "./retry.js";
import { ConfigurationError } from "./errors.js";

const fast = { baseDelayMs: 1, maxDelayMs: 5 };

describe("withRetry", () => {
  it("returns the result on first success", async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls += 1;
      return "ok";
    }, fast);
    expect(result).toBe("ok");
    expect(calls).toBe(1);
  });

  it("retries transient failures and eventually succeeds", async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls += 1;
      if (calls < 3) {
        throw new Error("transient 503");
      }
      return "recovered";
    }, fast);
    expect(result).toBe("recovered");
    expect(calls).toBe(3);
  });

  it("gives up after the configured attempts", async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls += 1;
        throw new Error("always down");
      }, { ...fast, attempts: 3 }),
    ).rejects.toThrow("always down");
    expect(calls).toBe(3);
  });

  it("does NOT retry configuration/auth errors", async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls += 1;
        throw new ConfigurationError("bad API key");
      }, fast),
    ).rejects.toThrow("bad API key");
    expect(calls).toBe(1);
  });

  it("honours a custom shouldRetry", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new Error("permanent 400");
        },
        { ...fast, shouldRetry: (e) => !(e instanceof Error && e.message.includes("400")) },
      ),
    ).rejects.toThrow("permanent 400");
    expect(calls).toBe(1);
  });
});
