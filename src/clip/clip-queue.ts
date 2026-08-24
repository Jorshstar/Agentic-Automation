import { withRetry } from "../lib/retry.js";
import type { ClipJob } from "./run-clip-job.js";

/**
 * A tiny Upstash-backed queue for clip jobs. The cloud Telegram agent ENQUEUES a
 * job when you ask it to clip a link; the LOCAL clip worker (running on your PC,
 * on a residential IP YouTube trusts) DEQUEUES and processes it. This is what
 * lets you keep the always-on chat while the download runs where it's allowed.
 *
 * Requires UPSTASH_REDIS_REST_URL + _TOKEN (same store the rest of the studio
 * uses). Without them, enqueue/dequeue are no-ops.
 */

const QUEUE_KEY = "content-studio:clip-queue";

export interface QueuedClipJob extends ClipJob {
  /** When it was enqueued (epoch ms). */
  readonly enqueuedAt: number;
}

export interface ClipQueue {
  enqueue(job: ClipJob): Promise<boolean>;
  /** Pop the oldest job, or undefined if the queue is empty. */
  dequeue(): Promise<QueuedClipJob | undefined>;
  size(): Promise<number>;
}

export function createClipQueue(): ClipQueue {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    return {
      async enqueue() {
        return false;
      },
      async dequeue() {
        return undefined;
      },
      async size() {
        return 0;
      },
    };
  }
  return new UpstashClipQueue(url, token);
}

class UpstashClipQueue implements ClipQueue {
  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  async enqueue(job: ClipJob): Promise<boolean> {
    const payload: QueuedClipJob = { ...job, enqueuedAt: Date.now() };
    // LPUSH + (worker) RPOP = FIFO.
    await this.command(["LPUSH", QUEUE_KEY, JSON.stringify(payload)]);
    return true;
  }

  async dequeue(): Promise<QueuedClipJob | undefined> {
    const result = await this.command(["RPOP", QUEUE_KEY]);
    if (typeof result !== "string") return undefined;
    try {
      return JSON.parse(result) as QueuedClipJob;
    } catch {
      return undefined;
    }
  }

  async size(): Promise<number> {
    const result = await this.command(["LLEN", QUEUE_KEY]);
    return typeof result === "number" ? result : 0;
  }

  private async command(command: readonly string[]): Promise<unknown> {
    const response = await withRetry(async () => {
      const res = await fetch(this.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(command),
      });
      if (!res.ok) throw new Error(`Upstash command failed (${res.status})`);
      return res;
    });
    const json = (await response.json()) as { result?: unknown };
    return json.result;
  }
}
