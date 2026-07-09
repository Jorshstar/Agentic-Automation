import { createClaudeAIKernel } from "../ai/index.js";
import type { AIKernel } from "../ai/index.js";
import { parseCommand } from "./command-parser.js";
import { TelegramClient } from "./telegram-client.js";
import { resolveBrief, runResolvedBrief } from "../studio/content-brief.js";
import type { ContentBrief, ResolvedBrief } from "../studio/content-brief.js";
import { buildUploadCaption } from "../studio/upload-caption.js";
import { StudioStageError } from "../studio/run-ledger.js";
import { TelegramDeliveryProvider } from "../providers/delivery/index.js";
import type { NicheProfile } from "../config/niche-profiles.js";

/**
 * StudioTelegramController — the studio's chat brain.
 *
 * One message in → understood command → SAFE action out:
 *   - creating always requires an explicit "yes" (a stray message can never
 *     spend money),
 *   - "preview" designs the identity (~1¢) before you commit,
 *   - runs execute one at a time with a live-edited progress message,
 *   - the finished video + upload kit arrive via the existing delivery,
 *   - failures alert with the exact resume command.
 */

interface Pending {
  readonly brief: ContentBrief;
  /** Set when the user previewed — "yes" then reuses the SAME identity. */
  readonly resolved?: ResolvedBrief;
}

interface QueueItem {
  readonly brief: ContentBrief;
  readonly resolved?: ResolvedBrief;
}

const YES = new Set(["yes", "y", "go", "ok", "okay", "start", "make it", "do it", "sure"]);
const NO = new Set(["no", "n", "cancel", "stop", "nevermind", "never mind"]);
const PREVIEW = new Set(["preview", "show me", "dry", "dry run"]);

const HELP_TEXT =
  "🎛 Studio remote control\n\n" +
  "Just tell me what to make, in plain words:\n" +
  '• "make a 90 second scary video about an abandoned lighthouse, deep slow voice, dark stormy pictures"\n' +
  '• "a calm bedtime history video about Rome"\n' +
  '• "tech news video about this week\'s AI tools"\n\n' +
  "I'll show you the plan first — nothing runs until you reply \"yes\".\n" +
  'Say "preview" to see the designed identity (~1¢) before committing.\n\n' +
  "Commands: status · help";

export class StudioTelegramController {
  private readonly kernel: AIKernel;
  private pending: Pending | undefined;
  private readonly queue: QueueItem[] = [];
  private running = false;
  private activity = "idle";
  private lastFinished = "";

  constructor(private readonly telegram: TelegramClient) {
    this.kernel = createClaudeAIKernel();
  }

  /** True while a run (or queued runs) are in flight. */
  get busy(): boolean {
    return this.running || this.queue.length > 0;
  }

  /** Handle one incoming message end-to-end (never throws). */
  async handle(text: string): Promise<void> {
    try {
      await this.route(text);
    } catch (error) {
      await this.telegram.send(`❌ Something went wrong handling that: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async route(text: string): Promise<void> {
    const bare = text.trim().toLowerCase();

    // Confirmation flow for a pending plan.
    if (this.pending) {
      if (YES.has(bare)) {
        const pending = this.pending;
        this.pending = undefined;
        this.enqueue({ brief: pending.brief, ...(pending.resolved ? { resolved: pending.resolved } : {}) });
        return;
      }
      if (NO.has(bare)) {
        this.pending = undefined;
        await this.telegram.send("👍 Cancelled. Tell me what to make instead.");
        return;
      }
      if (PREVIEW.has(bare)) {
        await this.preview(this.pending.brief);
        return;
      }
      // Anything else = a new request; fall through (replaces the pending plan).
    }

    const command = await parseCommand(this.kernel, text);

    switch (command.action) {
      case "help":
        await this.telegram.send(HELP_TEXT);
        return;
      case "status":
        await this.telegram.send(this.statusText());
        return;
      case "chat":
        await this.telegram.send(command.reply);
        return;
      case "preview":
        if (command.brief) {
          await this.preview(command.brief);
        }
        return;
      case "create":
        if (command.brief) {
          this.pending = { brief: command.brief };
          await this.telegram.send(this.planText(command.brief, command.note));
        }
        return;
    }
  }

  /** Design (or reuse) the identity and show it — costs ~1¢, renders nothing. */
  private async preview(brief: ContentBrief): Promise<void> {
    await this.telegram.send("🎨 Designing the identity...");
    const resolved = await resolveBrief(brief, this.kernel);
    this.pending = { brief, resolved };
    await this.telegram.send(
      `${formatIdentity(resolved.profile)}\n\nDuration: ~${resolved.run.targetDurationSeconds}s\n\nReply "yes" to make the video (~$0.40-0.60, ~5-8 min) or "no" to cancel.`,
    );
  }

  private planText(brief: ContentBrief, note?: string): string {
    const identityBits: string[] = [];
    if (brief.identity?.voice) {
      identityBits.push(`voice: ${brief.identity.voice}`);
    }
    if (brief.identity?.visualStyle) {
      identityBits.push(`pictures: ${brief.identity.visualStyle}`);
    }
    if (brief.identity?.musicMood) {
      identityBits.push(`music: ${brief.identity.musicMood}`);
    }
    return (
      `📋 Plan: ${brief.instructions}\n` +
      `format: ${brief.format ?? "narrated-short"} · identity: ${brief.niche ?? "AI-designed (custom)"} · duration: ${brief.durationSeconds ?? 65}s` +
      (identityBits.length > 0 ? `\n${identityBits.join(" · ")}` : "") +
      (note ? `\n\n⚠️ ${note}` : "") +
      `\n\nReply "yes" to start (~$0.40-0.60, ~5-8 min), "preview" to see the full identity first (~1¢), or "no" to cancel.`
    );
  }

  private statusText(): string {
    const lines = [`🎛 Studio status`, `now: ${this.activity}`, `queued: ${this.queue.length}`];
    if (this.lastFinished !== "") {
      lines.push(`last: ${this.lastFinished}`);
    }
    return lines.join("\n");
  }

  private enqueue(item: QueueItem): void {
    this.queue.push(item);
    if (this.running) {
      void this.telegram.send(`🕐 Queued (position ${this.queue.length}) — I'll start it after the current video.`);
      return;
    }
    void this.processQueue();
  }

  /** Run queued briefs one at a time with a live progress message. */
  private async processQueue(): Promise<void> {
    this.running = true;
    try {
      let item = this.queue.shift();
      while (item) {
        await this.produce(item);
        item = this.queue.shift();
      }
    } finally {
      this.running = false;
      this.activity = "idle";
    }
  }

  private async produce(item: QueueItem): Promise<void> {
    const progressId = await this.telegram.send("🎬 Starting...");
    const lines: string[] = [];
    const onStep = (message: string): void => {
      this.activity = message.trim();
      lines.push(message.trimEnd());
      if (progressId !== undefined) {
        const tail = lines.slice(-8).join("\n");
        void this.telegram.edit(progressId, `🎬 Working...\n${tail}`);
      }
    };

    try {
      const resolved = item.resolved ?? (await resolveBrief(item.brief, this.kernel));
      const result = await runResolvedBrief(resolved, { onStep });

      if (progressId !== undefined) {
        await this.telegram.edit(progressId, `✅ Done: ${result.topic.title} (${Math.round(result.durationSeconds)}s, QA ${result.qa.status.toUpperCase()}, $${result.costUsd.toFixed(2)})`);
      }

      if (!result.qa.passed) {
        this.lastFinished = `🚫 QA blocked "${result.topic.title}"`;
        await this.telegram.send(
          `🚫 QA BLOCKED this video — not delivering it.\n` +
            result.qa.checks.filter((c) => c.status === "fail").map((c) => `✗ ${c.label}: ${c.detail}`).join("\n") +
            `\nIt's kept at ${result.finalDir} if you want to inspect it.`,
        );
        return;
      }

      await new TelegramDeliveryProvider().deliver({
        videoPath: result.videoPath,
        caption: buildUploadCaption(result),
        documents: [result.uploadKitPath, result.thumbnailPath, result.wideThumbnailPath, result.manifestPath].filter((p) => p !== ""),
      });
      this.lastFinished = `✅ "${result.topic.title}" ($${result.costUsd.toFixed(2)})`;
    } catch (error) {
      const detail =
        error instanceof StudioStageError
          ? `failed at stage "${error.stage}".\nResume without re-paying completed stages:\nnpm run studio:resume -- ${error.runId}`
          : error instanceof Error
            ? error.message
            : String(error);
      this.lastFinished = "❌ last run failed";
      await this.telegram.send(`❌ Video run ${detail}`);
    }
  }
}

/** Human-readable identity card for previews. */
function formatIdentity(p: NicheProfile): string {
  return (
    `🎨 ${p.label}\n` +
    `audience: ${p.audience}\n` +
    `tone: ${p.tone} · pacing: ${p.pacing}\n` +
    `voice: ${p.voice} — ${p.voiceInstructions}\n` +
    `look: ${p.visualStyle}\n` +
    `colours: ${p.colorMood}\n` +
    `music: ${p.musicPreset} (${p.musicMood})\n` +
    `captions: ${p.captionFont}, ${p.captionPosition}, ${p.captionAccent}, karaoke ${p.captionKaraoke ? "on" : "off"}`
  );
}
