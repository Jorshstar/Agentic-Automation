import { join } from "node:path";
import { createClipQueue, isDocumentaryJob } from "./clip-queue.js";
import type { DocumentaryJob } from "./clip-queue.js";
import { runPart } from "../longform/run-part.js";
import { createSeriesStore } from "../longform/series.js";
import { TelegramDeliveryProvider } from "../providers/delivery/index.js";
import { uploadKit } from "../longform/upload-kit.js";
import { runClipJob } from "./run-clip-job.js";
import {
  archive,
  ensureWatchFolders,
  scanWatchFolder,
  StabilityTracker,
  watchFolders,
  WATCH_SEPARATOR,
} from "./watch-folder.js";
import type { WatchedFile } from "./watch-folder.js";
import { TelegramClient } from "../telegram/telegram-client.js";
import { logger } from "../lib/logger.js";

/**
 * LOCAL CLIP WORKER — the machine that actually makes the clips.
 *
 *   npm run studio:clip-worker
 *
 * It takes work from two places:
 *
 *   1. The QUEUE, filled by the Telegram agent when you ask it to clip a link.
 *      That runs here rather than in the cloud because YouTube blocks cloud IPs,
 *      and your home connection is trusted.
 *
 *   2. The WATCH FOLDER (`input/` by default). Drop a video in and it is
 *      clipped. This exists because Telegram refuses to hand a bot any file over
 *      20 MB — about three minutes of phone video — so the chat is not a usable
 *      way to submit a long recording. The file is already on this machine, so
 *      the shortest path is to read it from here.
 *
 *      Say what to clip in the file name, after " -- ":
 *        PSG vs Barca -- the goals.mp4
 *        podcast -- key insights, with subtitles.mp4
 *
 * Keep it running while you want clipping to work; anything queued while it is
 * off is picked up when it starts. Needs ffmpeg on PATH plus the usual .env keys.
 */

try {
  process.loadEnvFile();
} catch {
  // fall back to ambient env
}

const POLL_INTERVAL_MS = 5000;

async function main(): Promise<void> {
  const queue = createClipQueue();
  const telegram = new TelegramClient();
  const folders = watchFolders();
  const tracker = new StabilityTracker();
  await ensureWatchFolders(folders);

  await telegram.send(
    `🎬 Clip worker online — send me a video link, or drop a file in \`${folders.inbox}\`.`,
  );
  console.log("Clip worker running... (Ctrl+C to stop)");
  console.log(`  watching: ${folders.inbox}  (name files "video ${WATCH_SEPARATOR.trim()} the goals.mp4")`);

  for (;;) {
    let didWork = false;

    // 1. Queued links first — someone is waiting in the chat for those.
    try {
      const job = await queue.dequeue();
      if (job) {
        didWork = true;
        const report = (message: string): void => {
          console.log("  " + message);
          void telegram.send(message);
        };

        if (isDocumentaryJob(job)) {
          console.log(`⇐ documentary: ${job.topic || "[continue latest series]"}`);
          await handleDocumentary(job, telegram, report);
        } else {
          console.log(`⇐ clip job: ${job.fileId ? "[upload]" : job.url} (theme: ${job.theme})`);
          await process_(
            () =>
              runClipJob(job, {
                workDir: join("output", "clips", `local-${Date.now()}`),
                onStep: report,
              }),
            telegram,
          );
        }
      }
    } catch (error) {
      logger.error("clip queue read failed", { error: String(error) });
    }

    // 2. Then anything dropped in the watch folder.
    try {
      for (const file of await scanWatchFolder(folders, tracker)) {
        didWork = true;
        await handleWatchedFile(file, folders, tracker, telegram);
      }
    } catch (error) {
      logger.error("watch folder scan failed", { error: String(error) });
    }

    if (!didWork) await sleep(POLL_INTERVAL_MS);
  }
}

async function handleWatchedFile(
  file: WatchedFile,
  folders: ReturnType<typeof watchFolders>,
  tracker: StabilityTracker,
  telegram: TelegramClient,
): Promise<void> {
  const megabytes = (file.bytes / 1_000_000).toFixed(0);
  const theme = file.theme || "auto";
  console.log(`📂 picked up "${file.name}" (${megabytes} MB, theme: ${theme})`);
  await telegram.send(`📂 Found "${file.name}" (${megabytes} MB) — clipping ${file.theme || "the best bits"}…`);

  let ok = false;
  try {
    const result = await runClipJob(
      // The whole name-suffix is the user's own words, so the same phrasing that
      // works in chat ("vertical", "with subtitles", "remove the watermark")
      // works here too.
      { url: file.path, theme, count: 5, reframe: file.theme, captions: file.theme, tighten: file.theme, removeOverlays: file.theme },
      {
        workDir: join("output", "clips", `watch-${Date.now()}`),
        onStep: (message) => {
          console.log("  " + message);
          void telegram.send(message);
        },
      },
    );
    ok = result.delivered > 0;
    await telegram.send(
      ok
        ? `✅ Sent ${result.delivered} clip(s) from "${file.name}".`
        : `❌ Couldn't produce clips from "${file.name}".`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 400) : String(error);
    console.error(`  failed: ${message}`);
    await telegram.send(`❌ "${file.name}" failed:\n${message}`);
  } finally {
    // Always move it out of the inbox, success or not, so the worker cannot get
    // stuck retrying the same broken file forever.
    tracker.forget(file.path);
    const moved = await archive(file, folders, ok).catch(() => undefined);
    if (moved) console.log(`  → ${moved}`);
  }
}

/**
 * Make the next part of a documentary series, and deliver it.
 *
 * An empty topic means "continue whatever I was last working on", which is what
 * "do part 3" means in a chat where the subject was established earlier. The
 * most recently worked series is the only sensible reading, and it is far
 * better than refusing and asking the user to retype a topic they already gave.
 */
async function handleDocumentary(
  job: DocumentaryJob,
  telegram: TelegramClient,
  report: (message: string) => void,
): Promise<void> {
  try {
    const topic = job.topic.trim() || (await mostRecentSeriesTopic());
    if (!topic) {
      await telegram.send(
        "❓ I don't have a series in progress. Tell me the subject — " +
          'for example "make a documentary about the history of Instagram".',
      );
      return;
    }

    const result = await runPart({
      topic,
      targetSeconds: job.targetSeconds ?? 55,
      onStep: report,
    });

    const delivered = await new TelegramDeliveryProvider().deliver({
      videoPath: result.videoPath,
      caption:
        `📺 Part ${result.part} — ${result.title}\n\n` +
        `${Math.round(result.durationSeconds)}s · ${result.beats} beats · ` +
        `$${result.imagesCostUsd.toFixed(2)}\n` +
        `Sources: ${result.citations.slice(0, 2).join(", ")}`,
      // The cover goes as a DOCUMENT, not a photo. Telegram recompresses
      // photos, and a recompressed thumbnail is no use for the upload it was
      // drawn for.
      documents: result.thumbnailPath ? [result.thumbnailPath] : [],
    });

    // The upload kit, as text to paste straight into YouTube. It was being
    // written on every part and thrown away: the cover was drawn, the title,
    // description and tags were generated, and none of it left the machine.
    const kit = uploadKit(result);
    if (kit !== "") await telegram.send(kit);

    await telegram.send(
      result.complete
        ? `✅ That completes "${topic}".`
        : delivered.videoSent
          ? `✅ Part ${result.part} sent. Say "part ${result.part + 1}" when you want the next one.`
          : `⚠️ Part ${result.part} rendered but could not be delivered.`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 400) : String(error);
    console.error("documentary failed:", message);
    await telegram.send(`❌ Documentary failed:\n${message}`);
  }
}

/** The series worked on most recently, by its newest part's timestamp. */
async function mostRecentSeriesTopic(): Promise<string> {
  const all = await createSeriesStore().list();
  const open = all
    .filter((record) => !record.complete && record.parts.length > 0)
    .sort((a, b) => {
      const left = a.parts.at(-1)?.createdAt ?? "";
      const right = b.parts.at(-1)?.createdAt ?? "";
      return right.localeCompare(left);
    });
  return open[0]?.topic ?? "";
}

/** Run a queued job, reporting the outcome to the chat. */
async function process_(
  run: () => Promise<{ delivered: number; title: string; note?: string }>,
  telegram: TelegramClient,
): Promise<void> {
  try {
    const result = await run();
    // "Couldn't produce clips" was being said about clips that had rendered
    // perfectly and were then refused by the upload. If delivery is the reason,
    // say delivery — the user cannot fix a clipping bug that is not there.
    const failure = result.note
      ? `❌ Made the clips but couldn't send them:\n${result.note.slice(0, 300)}`
      : "❌ Couldn't produce clips from that one.";
    await telegram.send(
      result.delivered > 0
        ? `✅ Sent ${result.delivered} clip(s) from "${result.title.slice(0, 70)}".`
        : failure,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 400) : String(error);
    console.error("clip job failed:", message);
    await telegram.send(`❌ Clip job failed:\n${message}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error: unknown) => {
  logger.error("Clip worker crashed", { error: String(error) });
  process.exitCode = 1;
});
