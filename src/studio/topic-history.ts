import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { withRetry } from "../lib/retry.js";

/**
 * Topic history — the studio's MEMORY, so it never posts the same idea twice.
 *
 * Every produced video's topic is recorded here; the next run reads the recent
 * ones and (a) tells the topic generator to avoid them and (b) rejects an exact
 * repeat. Two backends behind one interface:
 *   - FileTopicHistoryStore  — a local JSON file (works out of the box, survives
 *     only where the filesystem persists, i.e. local / self-hosted runs).
 *   - UpstashTopicHistoryStore — a free Upstash Redis KV over REST (survives on
 *     Trigger.dev CLOUD, where the disk is ephemeral). Auto-selected when
 *     UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set.
 */

export interface UsedTopic {
  readonly title: string;
  readonly niche: string;
  readonly date: string;
  /**
   * Where and when the event happened. Recorded for HARD ROTATION: the next
   * research run is told to avoid these, so the studio can't drift back to the
   * same country or era every time. Absent on older records.
   */
  readonly country?: string;
  readonly era?: string;
}

/** Distinct countries used in the most recent runs (newest first). */
export function recentCountries(topics: readonly UsedTopic[], limit: number): readonly string[] {
  return distinct(topics.map((t) => t.country), limit);
}

/** Distinct historical eras used in the most recent runs (newest first). */
export function recentEras(topics: readonly UsedTopic[], limit: number): readonly string[] {
  return distinct(topics.map((t) => t.era), limit);
}

function distinct(values: readonly (string | undefined)[], limit: number): readonly string[] {
  const seen: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed && !seen.some((s) => s.toLowerCase() === trimmed.toLowerCase())) {
      seen.push(trimmed);
    }
    if (seen.length >= limit) {
      break;
    }
  }
  return seen;
}

export interface TopicHistoryStore {
  readonly name: string;
  /** Most-recent-first list of past topics (up to `limit`). Never throws. */
  recent(limit: number): Promise<readonly UsedTopic[]>;
  /** Record a newly-used topic. Never throws. */
  add(topic: UsedTopic): Promise<void>;
}

/** Normalize a title for exact-duplicate comparison. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9 ]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

const HISTORY_FILE = "output/history/used-topics.json";
const HISTORY_KEY = "content-studio:used-topics";
const MAX_HISTORY = 200;

/** Pick the right backend: Upstash if configured (cloud-safe), else a local file. */
export function createTopicHistoryStore(): TopicHistoryStore {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    return new UpstashTopicHistoryStore(url, token);
  }
  return new FileTopicHistoryStore(HISTORY_FILE);
}

/** Local JSON file backend. Newest entries first. */
export class FileTopicHistoryStore implements TopicHistoryStore {
  readonly name = "file-topic-history";

  constructor(private readonly filePath: string = HISTORY_FILE) {}

  async recent(limit: number): Promise<readonly UsedTopic[]> {
    return (await this.readAll()).slice(0, Math.max(0, limit));
  }

  async add(topic: UsedTopic): Promise<void> {
    try {
      const next = [topic, ...(await this.readAll())].slice(0, MAX_HISTORY);
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(this.filePath, JSON.stringify(next, null, 2), "utf8");
    } catch {
      // History is best-effort; never fail a run because we couldn't record it.
    }
  }

  private async readAll(): Promise<UsedTopic[]> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, "utf8"));
      return Array.isArray(parsed) ? (parsed as UsedTopic[]) : [];
    } catch {
      return [];
    }
  }
}

/** Upstash Redis (REST) backend — a capped list, newest first. Cloud-safe. */
export class UpstashTopicHistoryStore implements TopicHistoryStore {
  readonly name = "upstash-topic-history";

  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  async recent(limit: number): Promise<readonly UsedTopic[]> {
    const result = await this.command(["LRANGE", HISTORY_KEY, "0", String(Math.max(0, limit - 1))]);
    if (!Array.isArray(result)) {
      return [];
    }
    const topics: UsedTopic[] = [];
    for (const entry of result) {
      if (typeof entry === "string") {
        try {
          topics.push(JSON.parse(entry) as UsedTopic);
        } catch {
          // skip malformed entry
        }
      }
    }
    return topics;
  }

  async add(topic: UsedTopic): Promise<void> {
    try {
      await this.command(["LPUSH", HISTORY_KEY, JSON.stringify(topic)]);
      await this.command(["LTRIM", HISTORY_KEY, "0", String(MAX_HISTORY - 1)]);
    } catch {
      // best-effort
    }
  }

  private async command(command: readonly string[]): Promise<unknown> {
    // Transient Upstash failures retry with backoff (memory must be reliable —
    // a dropped read here could cause a repeated topic).
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
