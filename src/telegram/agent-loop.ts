import { TelegramClient } from "./telegram-client.js";
import type { RawUpdate } from "./telegram-client.js";
import {
  createConversationStore,
  withMessage,
  type ConversationStore,
  type PendingAsset,
} from "./upload-session.js";
import { TelegramAgentProvider } from "../providers/telegram-agent/index.js";
import { customUploadVideo } from "../trigger/content-studio/custom-upload-video.js";
import { createClipQueue } from "../clip/clip-queue.js";
import { logger } from "../lib/logger.js";

/**
 * THE TELEGRAM AGENT LOOP — one pass over the bot's pending updates.
 *
 * This lives apart from the Trigger.dev task on purpose. Telegram allows only
 * ONE consumer of a bot's updates, and the cloud schedule is normally it; but
 * while the cloud task is not deployed, or you are debugging, there has to be a
 * way to run exactly the same logic locally. Keeping the loop here means the
 * cloud task and the local worker cannot drift apart — which is what happened
 * to the clip pipeline before it was collapsed onto one function.
 *
 * Returns what it did so either caller can log it.
 */
export interface AgentTickResult {
  readonly processed: number;
  readonly builds: number;
}

export async function runAgentTick(): Promise<AgentTickResult> {
  const telegram = new TelegramClient();
  const store = createConversationStore();
  const agent = new TelegramAgentProvider();

  let offset = await store.getOffset();
  const updates = await telegram.pollRaw(offset, 0);
  if (updates.length === 0) {
    return { processed: 0, builds: 0 };
  }

  let builds = 0;
  for (const update of updates) {
    offset = Math.max(offset, update.updateId + 1);

    // Non-message update, or a chat that isn't the owner → consume + ignore.
    if (update.chatId === "" || update.chatId !== telegram.ownerChatId) {
      continue;
    }
    try {
      if (await handleUpdate(update, telegram, store, agent)) {
        builds++;
      }
    } catch (error) {
      logger.error("telegram agent update failed", { error: String(error) });
    }
  }

  await store.setOffset(offset);
  return { processed: updates.length, builds };
}

const RESET_WORDS = new Set(["reset", "cancel", "start over", "new chat", "clear"]);

/**
 * Handle one owner update: fold in any attachments, run the agent brain over the
 * conversation, reply, and fire a build if the agent decided the user confirmed.
 * Returns true when a build was triggered.
 */
async function handleUpdate(
  update: RawUpdate,
  telegram: TelegramClient,
  store: ConversationStore,
  agent: TelegramAgentProvider,
): Promise<boolean> {
  let session = await store.getSession(update.chatId);
  const normalized = update.text.trim().toLowerCase();

  // Hard reset — wipe the conversation and its attachments.
  if (RESET_WORDS.has(normalized)) {
    await store.clearSession(update.chatId);
    await telegram.send("🧹 Fresh start. What do you want to dream up?");
    return false;
  }

  // Fold in any optional attachments and build this turn's user message.
  if (update.media.length > 0) {
    const assets: PendingAsset[] = [
      ...session.assets,
      ...update.media.map((m) => ({ fileId: m.fileId, kind: m.kind })),
    ];
    session = { ...session, assets, updatedAt: Date.now() };
  }
  const userText = composeUserText(update);
  if (userText === "") {
    // Nothing actionable (e.g. an empty non-text update slipped through).
    await store.setSession(update.chatId, session);
    return false;
  }
  session = withMessage(session, { role: "user", text: userText });

  // Run the creative brain over the whole conversation.
  const decision = await agent.respond({ messages: session.messages, assetCount: session.assets.length });
  session = withMessage(session, { role: "assistant", text: decision.reply });

  if (decision.action === "build") {
    const useAssets = decision.useAssets && session.assets.length > 0;
    await customUploadVideo.trigger({
      brief: decision.brief,
      assets: useAssets ? session.assets.map((a) => ({ fileId: a.fileId, kind: a.kind })) : [],
    });
    // Consume the attachments so the next video doesn't silently reuse them; keep
    // the chat history so the conversation continues naturally.
    session = { ...session, assets: [] };
    await store.setSession(update.chatId, session);
    await telegram.send(decision.reply);
    return true;
  }

  if (decision.action === "documentary") {
    // Runs on the local worker: it needs ffmpeg, and it shares the clip queue
    // so there is a single place for work to be stuck and one worker to keep
    // running. An empty topic means "continue the series already in progress".
    const queue = createClipQueue();
    const queued = await queue.enqueue({
      kind: "documentary",
      topic: decision.documentaryTopic,
    });
    await store.setSession(update.chatId, session);
    await telegram.send(
      queued
        ? `${decision.reply}\n\n(Queued for your studio machine — it takes a few minutes.)`
        : `${decision.reply}\n\n⚠️ The job queue isn't configured (needs Upstash Redis).`,
    );
    return true;
  }

  if (decision.action === "clip") {
    // A clip job needs a source: either a link the user shared, or the most
    // recent video they uploaded into the chat. With neither, this is still a
    // conversation, so fall through and just reply.
    const upload = session.assets.filter((asset) => asset.kind === "video").at(-1);
    if (decision.url === "" && !upload) {
      await store.setSession(update.chatId, session);
      await telegram.send(decision.reply);
      return false;
    }

    // YouTube blocks cloud IPs, so clip jobs run on the user's local worker (a
    // residential IP). Enqueue it; the worker drains the queue when it's online.
    const queue = createClipQueue();
    const queued = await queue.enqueue({
      url: decision.url,
      fileId: decision.url === "" ? upload?.fileId : undefined,
      theme: decision.theme,
      count: decision.count,
      reframe: decision.layout,
    });

    // Consume the upload so a later "clip it" doesn't silently re-clip an old
    // video — the same rule the build path already follows for its assets.
    if (decision.url === "" && upload) {
      session = { ...session, assets: session.assets.filter((asset) => asset.fileId !== upload.fileId) };
    }
    await store.setSession(update.chatId, session);
    await telegram.send(
      queued
        ? `${decision.reply}\n\n(Queued for your clip machine — it'll process when online.)`
        : `${decision.reply}\n\n⚠️ Clip queue isn't configured (needs Upstash Redis).`,
    );
    return true;
  }

  await store.setSession(update.chatId, session);
  await telegram.send(decision.reply);
  return false;
}

/** Turn an update into the user's message text, noting any optional attachments. */
function composeUserText(update: RawUpdate): string {
  const text = update.text.trim();
  if (update.media.length === 0) {
    return text;
  }
  const photos = update.media.filter((m) => m.kind === "photo").length;
  const videos = update.media.filter((m) => m.kind === "video").length;
  const parts: string[] = [];
  if (photos > 0) parts.push(`${photos} photo${photos > 1 ? "s" : ""}`);
  if (videos > 0) parts.push(`${videos} video${videos > 1 ? "s" : ""}`);
  const note = `[attached ${parts.join(" and ")}]`;
  return text !== "" ? `${text}\n${note}` : note;
}
