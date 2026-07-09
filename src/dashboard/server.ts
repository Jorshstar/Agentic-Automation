/**
 * Studio Dashboard — a local web control room (Phase 4).
 *
 *   npm run studio:dashboard   →   http://localhost:4321
 *
 * Zero new dependencies: node:http + one self-contained HTML page. Everything it
 * shows comes from data the pipeline already writes (run ledgers, briefs, the
 * final library) — the dashboard is a WINDOW, not a second source of truth.
 *
 * SECURITY: binds to 127.0.0.1 only (never exposed to the network); media paths
 * are resolved and confined to the output/ directory.
 */
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createReadStream } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve, normalize, extname } from "node:path";
import { resolveBrief, startBrief } from "../studio/content-brief.js";
import type { ContentBrief } from "../studio/content-brief.js";
import { NICHE_PROFILES } from "../config/niche-profiles.js";
import { VIDEO_FORMATS, isVideoFormat } from "../studio/formats.js";
import { TelegramDeliveryProvider } from "../providers/delivery/index.js";
import type { PresetNiche } from "../types/index.js";
import { logger } from "../lib/logger.js";

try {
  process.loadEnvFile();
} catch {
  // No .env — fall back to the ambient environment.
}

const PORT = 4321;
const OUTPUT_ROOT = resolve("output");
const PAGE_PATH = join("src", "dashboard", "index.html");

/** One run at a time from the dashboard (same guard the Telegram remote uses). */
let activeRunId: string | undefined;

const server = createServer((req, res) => {
  void route(req, res).catch((error: unknown) => {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  });
});

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname;

  if (req.method === "GET" && path === "/") {
    const html = await readFile(PAGE_PATH, "utf8");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }
  if (req.method === "GET" && path === "/api/status") {
    sendJson(res, 200, { activeRunId: activeRunId ?? null, formats: VIDEO_FORMATS, niches: Object.keys(NICHE_PROFILES) });
    return;
  }
  if (req.method === "GET" && path === "/api/runs") {
    sendJson(res, 200, await listRuns());
    return;
  }
  if (req.method === "GET" && path === "/api/library") {
    sendJson(res, 200, await listLibrary());
    return;
  }
  if (req.method === "GET" && path === "/api/profiles") {
    sendJson(res, 200, NICHE_PROFILES);
    return;
  }
  if (req.method === "POST" && path === "/api/brief") {
    await handleBrief(req, res);
    return;
  }
  if (req.method === "POST" && path === "/api/deliver") {
    await handleDeliver(req, res);
    return;
  }
  if (req.method === "GET" && path.startsWith("/media/")) {
    await serveMedia(req, res, decodeURIComponent(path.slice("/media/".length)));
    return;
  }
  sendJson(res, 404, { error: "not found" });
}

/* --------------------------------- runs api --------------------------------- */

interface RunSummary {
  readonly runId: string;
  readonly niche: string;
  readonly status: string;
  readonly costUsd: number;
  readonly stages: readonly { name: string; status: string; costUsd: number }[];
  readonly updatedAt: number;
}

async function listRuns(): Promise<readonly RunSummary[]> {
  const runsDir = join(OUTPUT_ROOT, "runs");
  const entries = await readdir(runsDir).catch(() => [] as string[]);
  const runs: RunSummary[] = [];
  for (const entry of entries) {
    try {
      const ledgerPath = join(runsDir, entry, "run.json");
      const info = await stat(ledgerPath);
      const ledger = JSON.parse(await readFile(ledgerPath, "utf8")) as {
        runId?: string;
        niche?: string;
        status?: string;
        totalCostUsd?: number;
        stages?: readonly { name?: string; status?: string; costUsd?: number }[];
      };
      runs.push({
        runId: ledger.runId ?? entry,
        niche: ledger.niche ?? "?",
        status: ledger.status ?? "?",
        costUsd: ledger.totalCostUsd ?? 0,
        stages: (ledger.stages ?? []).map((s) => ({
          name: s.name ?? "?",
          status: s.status ?? "?",
          costUsd: s.costUsd ?? 0,
        })),
        updatedAt: info.mtimeMs,
      });
    } catch {
      // Unreadable ledger — skip it rather than break the list.
    }
  }
  return runs.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 100);
}

/* -------------------------------- library api ------------------------------- */

interface LibraryItem {
  readonly dir: string;
  readonly title: string;
  readonly niche: string;
  readonly durationSeconds: number;
  readonly qaPassed: boolean;
  readonly createdAt: string;
  readonly ytTitle: string;
  readonly hashtags: readonly string[];
  readonly hasVideo: boolean;
  readonly hasThumb: boolean;
}

async function listLibrary(): Promise<readonly LibraryItem[]> {
  const finalDir = join(OUTPUT_ROOT, "final");
  const entries = await readdir(finalDir).catch(() => [] as string[]);
  const items: LibraryItem[] = [];
  for (const entry of entries) {
    try {
      const manifest = JSON.parse(await readFile(join(finalDir, entry, "manifest.json"), "utf8")) as {
        title?: string;
        niche?: string;
        durationSeconds?: number;
        qa?: { passed?: boolean };
        createdAt?: string;
        seo?: { youtube?: { title?: string }; tiktok?: { hashtags?: readonly string[] } };
      };
      items.push({
        dir: entry,
        title: manifest.title ?? entry,
        niche: manifest.niche ?? "?",
        durationSeconds: Math.round(manifest.durationSeconds ?? 0),
        qaPassed: manifest.qa?.passed ?? false,
        createdAt: manifest.createdAt ?? "",
        ytTitle: manifest.seo?.youtube?.title ?? manifest.title ?? entry,
        hashtags: manifest.seo?.tiktok?.hashtags ?? [],
        hasVideo: await exists(join(finalDir, entry, "video.mp4")),
        hasThumb: await exists(join(finalDir, entry, "thumbnail.jpg")),
      });
    } catch {
      // No manifest — not a finished package.
    }
  }
  return items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/* --------------------------------- brief api -------------------------------- */

async function handleBrief(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = (await readBody(req)) as {
    instructions?: string;
    niche?: string;
    format?: string;
    durationSeconds?: number;
    dry?: boolean;
  };
  const instructions = (body.instructions ?? "").trim();
  if (instructions === "") {
    sendJson(res, 400, { error: "instructions are required" });
    return;
  }

  const brief: ContentBrief = {
    instructions,
    ...(body.niche && body.niche in NICHE_PROFILES ? { niche: body.niche as PresetNiche } : {}),
    ...(isVideoFormat(body.format) ? { format: body.format } : {}),
    ...(typeof body.durationSeconds === "number" && body.durationSeconds >= 15 && body.durationSeconds <= 600
      ? { durationSeconds: body.durationSeconds }
      : {}),
  };

  if (body.dry === true) {
    const resolved = await resolveBrief(brief);
    sendJson(res, 200, { dry: true, profile: resolved.profile, run: resolved.run, warnings: resolved.warnings });
    return;
  }

  if (activeRunId !== undefined) {
    sendJson(res, 409, { error: `a run is already in progress (${activeRunId}) — wait for it to finish` });
    return;
  }

  const { runId, done } = await startBrief(brief);
  activeRunId = runId;
  done
    .catch((error: unknown) => {
      logger.error("Dashboard run failed", { runId, error: String(error) });
    })
    .finally(() => {
      if (activeRunId === runId) {
        activeRunId = undefined;
      }
    });
  sendJson(res, 200, { runId });
}

/* -------------------------------- deliver api ------------------------------- */

async function handleDeliver(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = (await readBody(req)) as { dir?: string };
  const dir = (body.dir ?? "").trim();
  const packageDir = confineToOutput(join("final", dir));
  if (dir === "" || packageDir === undefined) {
    sendJson(res, 400, { error: "invalid package dir" });
    return;
  }
  const manifest = JSON.parse(await readFile(join(packageDir, "manifest.json"), "utf8")) as {
    title?: string;
    hook?: string;
    niche?: string;
    durationSeconds?: number;
    qa?: { status?: string };
    seo?: { youtube?: { title?: string }; tiktok?: { hashtags?: readonly string[] } };
  };
  const caption =
    `🎬 ${manifest.seo?.youtube?.title ?? manifest.title ?? dir}\n` +
    `${manifest.hook ?? ""}\n\n` +
    `${manifest.niche ?? ""} · ${Math.round(manifest.durationSeconds ?? 0)}s · QA: ${(manifest.qa?.status ?? "?").toUpperCase()}\n` +
    `\n${(manifest.seo?.tiktok?.hashtags ?? []).join(" ")}`;

  const result = await new TelegramDeliveryProvider().deliver({
    videoPath: join(packageDir, "video.mp4"),
    caption,
    documents: [join(packageDir, "upload.txt"), join(packageDir, "thumbnail.jpg")].filter(Boolean),
  });
  sendJson(res, result.delivered ? 200 : 502, result);
}

/* ------------------------------- media serving ------------------------------ */

const MIME: Readonly<Record<string, string>> = {
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".srt": "text/plain; charset=utf-8",
};

/** Resolve a relative media path and REFUSE anything escaping output/. */
function confineToOutput(rel: string): string | undefined {
  const full = resolve(normalize(join(OUTPUT_ROOT, rel)));
  return full.startsWith(OUTPUT_ROOT) ? full : undefined;
}

async function serveMedia(req: IncomingMessage, res: ServerResponse, rel: string): Promise<void> {
  const full = confineToOutput(rel);
  if (full === undefined) {
    sendJson(res, 403, { error: "forbidden" });
    return;
  }
  let info;
  try {
    info = await stat(full);
  } catch {
    sendJson(res, 404, { error: "not found" });
    return;
  }
  const type = MIME[extname(full).toLowerCase()] ?? "application/octet-stream";

  // Range support so <video> can seek.
  const range = req.headers.range;
  const match = typeof range === "string" ? range.match(/bytes=(\d*)-(\d*)/u) : null;
  if (match) {
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
    res.writeHead(206, {
      "Content-Type": type,
      "Content-Range": `bytes ${start}-${end}/${info.size}`,
      "Accept-Ranges": "bytes",
      "Content-Length": end - start + 1,
    });
    createReadStream(full, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { "Content-Type": type, "Content-Length": info.size, "Accept-Ranges": "bytes" });
  createReadStream(full).pipe(res);
}

/* --------------------------------- utilities -------------------------------- */

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

server.listen(PORT, "127.0.0.1", () => {
  console.log(`🎛 Studio dashboard → http://localhost:${PORT}`);
});
