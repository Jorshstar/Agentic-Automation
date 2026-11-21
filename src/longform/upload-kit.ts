/**
 * THE UPLOAD KIT — the title, description, tags and hashtags, formatted to be
 * pasted straight into YouTube.
 *
 * This lives in its own module rather than inside the worker because the
 * worker starts a polling loop at import time, so anything defined beside it
 * cannot be tested without starting a bot.
 *
 * The kit was being generated on every documentary part and then thrown away:
 * the cover was drawn, the title, description, tags and hashtags were all
 * written, the log said so, and none of it ever left the machine. A part
 * arrived as a video with nothing to publish it with.
 */

export interface UploadKitFields {
  readonly youtubeTitle: string;
  readonly youtubeDescription: string;
  readonly tags: readonly string[];
  readonly hashtags?: readonly string[];
}

/** Telegram's message ceiling is 4096; this leaves room for the framing. */
const MESSAGE_BUDGET = 3900;
/** YouTube itself ignores tags past roughly this many. */
const MAX_TAGS = 20;
/** More than a handful of hashtags reads as spam and YouTube shows three. */
const MAX_HASHTAGS = 6;

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
  const tags = clean(fields.tags, MAX_TAGS).join(", ");
  // Normalise to "#tag": the model is inconsistent about the leading hash and
  // about spaces inside a tag, and both break a paste into YouTube.
  const hashtags = clean(fields.hashtags ?? [], MAX_HASHTAGS)
    .map((tag) => `#${tag.replace(/^#+/u, "").replace(/\s+/gu, "")}`)
    .filter((tag) => tag.length > 1)
    .join(" ");

  if (title === "" && description === "" && tags === "" && hashtags === "") return "";

  const titleBlock = title === "" ? "" : `📝 TITLE\n${title}\n\n`;
  const tagBlock = tags === "" ? "" : `\n\n🏷 TAGS\n${tags}`;
  const hashBlock = hashtags === "" ? "" : `\n\n#️⃣ HASHTAGS\n${hashtags}`;

  const room = MESSAGE_BUDGET - titleBlock.length - tagBlock.length - hashBlock.length;
  const trimmed =
    description.length > room ? `${description.slice(0, Math.max(0, room - 1))}…` : description;

  return (
    titleBlock + (trimmed === "" ? "" : `📄 DESCRIPTION\n${trimmed}`) + tagBlock + hashBlock
  );
}

function clean(values: readonly string[], limit: number): string[] {
  return values
    .map((value) => value.trim())
    .filter((value) => value !== "")
    .slice(0, limit);
}
