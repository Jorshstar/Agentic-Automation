import { schedules } from "@trigger.dev/sdk";
import { TelegramClient } from "../../telegram/telegram-client.js";
import type { RawUpdate } from "../../telegram/telegram-client.js";
import {
  createConversationStore,
  withMessage,
  type ConversationStore,
  type PendingAsset,
} from "../../telegram/upload-session.js";
import { ClaudeTelegramAgentProvider } from "../../providers/telegram-agent/index.js";
import { customUploadVideo } from "./custom-upload-video.js";
import { createClipQueue } from "../../clip/clip-queue.js";
import { logger } from "../../lib/logger.js";

/**
 * TELEGRAM AGENT — an always-on creative partner you chat with to make videos.
 *
 * Runs every minute in Trigger cloud and is the SINGLE consumer of the bot's
 * updates (Telegram allows only one — so the local `studio:listen` must NOT run
 * at the same time). Every message you send goes to the {@link ClaudeTelegramAgentProvider}
 * brain, which brainstorms, asks questions, and — only when you clearly say to
 * make it — fires {@link customUploadVideo} with a finished brief. Photos/videos
 * are OPTIONAL extras it can weave in; a video can be built from words alone.
 *
 * SECURITY: only TELEGRAM_CHAT_ID may drive the studio; other chats are ignored
 * (their updates are still consumed so the offset advances).
 */
export const telegramIngest = schedules.task({
  id: "telegram-ingest",
  cron: "* * * * *", // every minute (Telegram getUpdates has no push; poll is fine)
  run: async (): Promise<{ processed: number; builds: number }> => {
    const telegram = new TelegramClient();
    const store = createConversationStore();
    const agent = new ClaudeTelegramAgentProvider();

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
        logger.error("telegram-ingest update failed", { error: String(error) });
      }
    }

    await store.setOffset(offset);
    logger.info("telegram-ingest tick", { processed: updates.length, builds });
    return { processed: updates.length, builds };
  },
});

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
  agent: ClaudeTelegramAgentProvider,
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

  if (decision.action === "clip") {
    // YouTube blocks cloud IPs, so clip jobs run on the user's local worker (a
    // residential IP). Enqueue it; the worker drains the queue when it's online.
    const queue = createClipQueue();
    const queued = await queue.enqueue({ url: decision.url, theme: decision.theme, count: decision.count });
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
