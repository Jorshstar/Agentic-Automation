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
/** Three attempts at ten seconds: bounded, not forever. */
const COMMAND_TIMEOUT_MS = 10_000;

/**
 * A documentary job: make the next part of a narrated series.
 *
 * It shares the clip queue rather than having one of its own because both are
 * work the LOCAL machine must do — clips because YouTube blocks cloud IPs,
 * documentaries because they need ffmpeg — and one queue means one place for a
 * job to be stuck and one worker to keep running.
 */
export interface DocumentaryJob {
  readonly kind: "documentary";
  /**
   * The subject. Empty means "continue whichever series was worked on most
   * recently", which is what "do part 3" means when nothing else is said.
   */
  readonly topic: string;
  readonly targetSeconds?: number;
}

/** Clip jobs predate the `kind` field, so an absent kind means a clip. */
export type StudioJob = (ClipJob & { readonly kind?: "clip" }) | DocumentaryJob;

export type QueuedJob = StudioJob & {
  /** When it was enqueued (epoch ms). */
  readonly enqueuedAt: number;
};

/** Backwards-compatible alias for callers that only deal in clips. */
export type QueuedClipJob = ClipJob & { readonly enqueuedAt: number };

export function isDocumentaryJob(job: StudioJob): job is DocumentaryJob {
  return (job as DocumentaryJob).kind === "documentary";
}

export interface ClipQueue {
  enqueue(job: StudioJob): Promise<boolean>;
  /** Pop the oldest job, or undefined if the queue is empty. */
  dequeue(): Promise<QueuedJob | undefined>;
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
      async dequeue(): Promise<QueuedJob | undefined> {
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

  async enqueue(job: StudioJob): Promise<boolean> {
    const payload: QueuedJob = { ...job, enqueuedAt: Date.now() };
    // LPUSH + (worker) RPOP = FIFO.
    await this.command(["LPUSH", QUEUE_KEY, JSON.stringify(payload)]);
    return true;
  }

  async dequeue(): Promise<QueuedJob | undefined> {
    const result = await this.command(["RPOP", QUEUE_KEY]);
    if (typeof result !== "string") return undefined;
    try {
      return JSON.parse(result) as QueuedJob;
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
        // Without a deadline a half-open socket stalls the poll forever, and a
        // worker that is neither working nor erroring is the hardest kind of
        // down to notice.
        signal: AbortSignal.timeout(COMMAND_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`Upstash command failed (${res.status})`);
      return res;
    });
    const json = (await response.json()) as { result?: unknown };
    return json.result;
  }
}
