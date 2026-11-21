/**
 * THE UPLOAD KIT — the title, description and tags, formatted to be pasted
 * straight into YouTube.
 *
 * This lives in its own module rather than inside the worker because the
 * worker starts a polling loop at import time, so anything defined beside it
 * cannot be tested without starting a bot.
 *
 * The kit was being generated on every documentary part and then thrown away:
 * the cover was drawn, the title, description and tags were written, the log
 * said so, and none of it ever left the machine. A part arrived as a video
 * with nothing to publish it with.
 */

export interface UploadKitFields {
  readonly youtubeTitle: string;
  readonly youtubeDescription: string;
  readonly tags: readonly string[];
}

/** Telegram's message ceiling is 4096; this leaves room for the framing. */
const MESSAGE_BUDGET = 3900;
const MAX_TAGS = 20;

/**
 * Returns "" when there is nothing worth sending, so the caller can skip the
 * message rather than post an empty heading.
 *
 * The description is the only part that can run long, so it is the only part
 * that gets trimmed — losing half a title or a tag list would make both
 * useless, while a clipped description is still a starting point.
 */
export function uploadKit(fields: UploadKitFields): string {
  const title = fields.youtubeTitle.trim();
  const description = fields.youtubeDescription.trim();
  const tags = fields.tags
    .map((tag) => tag.trim())
    .filter((tag) => tag !== "")
    .slice(0, MAX_TAGS)
    .join(", ");

  if (title === "" && description === "" && tags === "") return "";

  const titleBlock = title === "" ? "" : `📝 TITLE\n${title}\n\n`;
  const tagBlock = tags === "" ? "" : `\n\n🏷 TAGS\n${tags}`;
  const room = MESSAGE_BUDGET - titleBlock.length - tagBlock.length;

  const trimmed =
    description.length > room ? `${description.slice(0, Math.max(0, room - 1))}…` : description;

  return titleBlock + (trimmed === "" ? "" : `📄 DESCRIPTION\n${trimmed}`) + tagBlock;
}
