import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { withRetry } from "../lib/retry.js";
import type { SeriesOutline } from "./outline.js";

/**
 * SERIES STATE — what a multi-part documentary has already covered.
 *
 * A long subject is told as a run of normal-length videos rather than one long
 * one: part one today, part two tomorrow. That is cheaper per run, keeps each
 * part independently watchable, and contains failure — a thirteen-minute render
 * dying at minute eleven loses everything, while a fifty-second part costs
 * pennies to redo.
 *
 * What it costs is CONTINUITY, and that is what this stores. Part two has to
 * know what part one already said, pick up where it stopped, and not repeat
 * itself — none of which the model can know on its own, because each run is a
 * fresh call with no memory of the last.
 *
 * Only a SUMMARY of each part is kept, not its full text. Feeding every earlier
 * script into every later prompt would grow without limit and spend more on
 * re-reading old parts than on writing new ones. A summary plus the closing
 * line is enough to continue from.
 */

export interface SeriesPart {
  readonly part: number;
  readonly title: string;
  /** A few lines on what this part covered, written at generation time. */
  readonly summary: string;
  /** The last thing said, so the next part can pick up the thread. */
  readonly lastLine: string;
  /** ISO timestamp. */
  readonly createdAt: string;
  readonly videoPath?: string;
}

export interface SeriesRecord {
  readonly seriesId: string;
  readonly topic: string;
  /**
   * The whole arc, planned once from the sources on the first part.
   *
   * Stored so later parts need no re-planning, and so the series knows how many
   * parts the material actually supports rather than running until the writer
   * is inventing.
   */
  readonly outline?: SeriesOutline;
  /** Source URLs, kept so later parts cite the same material. */
  readonly citations: readonly string[];
  readonly parts: readonly SeriesPart[];
  /** Set once the writer reports the story is told. */
  readonly complete: boolean;
}

export interface SeriesStore {
  get(seriesId: string): Promise<SeriesRecord | undefined>;
  save(record: SeriesRecord): Promise<void>;
  list(): Promise<readonly SeriesRecord[]>;
}

/** A stable id from a topic, so "Part 2" finds the right series. */
export function seriesIdFor(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 60);
}

/**
 * What the writer needs to continue a series: what came before, in brief.
 * Empty for part one.
 */
export function continuationBrief(record: SeriesRecord | undefined): string {
  if (!record || record.parts.length === 0) return "";
  const parts = record.parts
    .map((part) => `Part ${part.part} — ${part.title}\n${part.summary}`)
    .join("\n\n");
  const last = record.parts.at(-1)!;
  return (
    `${parts}\n\n` +
    `The previous part ended on this line:\n"${last.lastLine}"\n\n` +
    `This is PART ${record.parts.length + 1}. Continue from there. Do not retell ` +
    `anything above — the viewer has seen it.`
  );
}

/* ------------------------------- file store ------------------------------- */

export class FileSeriesStore implements SeriesStore {
  constructor(private readonly filePath = "output/longform/series.json") {}

  async get(seriesId: string): Promise<SeriesRecord | undefined> {
    const all = await this.readAll();
    return all[seriesId];
  }

  async save(record: SeriesRecord): Promise<void> {
    const all = await this.readAll();
    all[record.seriesId] = record;
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(all, null, 2), "utf8");
  }

  async list(): Promise<readonly SeriesRecord[]> {
    return Object.values(await this.readAll());
  }

  private async readAll(): Promise<Record<string, SeriesRecord>> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, "utf8"));
      return parsed && typeof parsed === "object" ? (parsed as Record<string, SeriesRecord>) : {};
    } catch {
      return {}; // not written yet
    }
  }
}

/* ------------------------------ upstash store ----------------------------- */

const KEY_PREFIX = "longform:series:";
/** Three attempts at ten seconds is ~30s worst case, not forever. */
const COMMAND_TIMEOUT_MS = 10_000;

export class UpstashSeriesStore implements SeriesStore {
  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  async get(seriesId: string): Promise<SeriesRecord | undefined> {
    const result = await this.command(["GET", `${KEY_PREFIX}${seriesId}`]);
    if (typeof result !== "string") return undefined;
    try {
      return JSON.parse(result) as SeriesRecord;
    } catch {
      return undefined;
    }
  }

  async save(record: SeriesRecord): Promise<void> {
    await this.command(["SET", `${KEY_PREFIX}${record.seriesId}`, JSON.stringify(record)]);
  }

  async list(): Promise<readonly SeriesRecord[]> {
    const keys = await this.command(["KEYS", `${KEY_PREFIX}*`]);
    if (!Array.isArray(keys)) return [];
    const records: SeriesRecord[] = [];
    for (const key of keys) {
      if (typeof key !== "string") continue;
      const id = key.slice(KEY_PREFIX.length);
      const record = await this.get(id);
      if (record) records.push(record);
    }
    return records;
  }

  private async command(command: readonly string[]): Promise<unknown> {
    const response = await withRetry(async () => {
      const result = await fetch(this.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(command),
        // A fetch with no deadline can wait forever on a half-open socket, and
        // this call sits at the END of a finished documentary: the video was
        // rendered, the cover drawn, the upload kit written, and then the run
        // stopped for thirteen minutes on a save, with nothing delivered and
        // nothing in the log to say why.
        signal: AbortSignal.timeout(COMMAND_TIMEOUT_MS),
      });
      if (!result.ok) throw new Error(`Upstash command failed (${result.status})`);
      return result;
    });
    const json = (await response.json()) as { result?: unknown };
    return json.result;
  }
}

/* ------------------------------ mirrored store ----------------------------- */

/**
 * Upstash, with a local file kept in step behind it.
 *
 * Losing this record is not cosmetic — it is what part two reads to know what
 * part one already said, so a failed save means the next part retells the
 * story. But a failed save must not cost the finished video either, and
 * Upstash on this machine has been intermittent ("clip queue read failed:
 * TypeError: fetch failed" several times in one day).
 *
 * So every write goes to both, and a remote failure is reported and survived
 * rather than thrown. A read prefers the remote — the cloud task may have
 * written a part this machine never saw — and falls back to the file.
 */
export class MirroredSeriesStore implements SeriesStore {
  constructor(
    private readonly remote: SeriesStore,
    private readonly local: SeriesStore = new FileSeriesStore(),
    private readonly onWarn: (message: string) => void = () => {},
  ) {}

  async get(seriesId: string): Promise<SeriesRecord | undefined> {
    try {
      const remote = await this.remote.get(seriesId);
      if (remote) return remote;
    } catch (error) {
      this.onWarn(`series lookup failed remotely (${short(error)}) — using the local copy`);
    }
    return this.local.get(seriesId);
  }

  async save(record: SeriesRecord): Promise<void> {
    // Local first: it is the copy that cannot fail for network reasons, and it
    // is what keeps the series continuous if the remote is down.
    await this.local.save(record).catch(() => {});
    try {
      await this.remote.save(record);
    } catch (error) {
      this.onWarn(`series save failed remotely (${short(error)}) — kept locally`);
    }
  }

  async list(): Promise<readonly SeriesRecord[]> {
    try {
      const remote = await this.remote.list();
      if (remote.length > 0) return remote;
    } catch {
      /* fall through to the local copy */
    }
    return this.local.list();
  }
}

function short(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 120);
}

/**
 * Upstash mirrored to a local file when it is configured, the file alone
 * otherwise.
 *
 * The file store is not a degraded fallback here: the whole studio runs on one
 * machine, so a file is a perfectly good home for this. Upstash matters only
 * when the cloud task and the local worker both need to see the same series.
 */
export function createSeriesStore(onWarn?: (message: string) => void): SeriesStore {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return new FileSeriesStore();
  return new MirroredSeriesStore(new UpstashSeriesStore(url, token), new FileSeriesStore(), onWarn);
}
