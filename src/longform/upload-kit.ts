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

/** Telegram's message ceiling is 4096; this leaves room for a continuation marker. */
const MESSAGE_LIMIT = 3900;
/** YouTube itself ignores tags past roughly this many. */
const MAX_TAGS = 20;
/** More than a handful of hashtags reads as spam and YouTube shows three. */
const MAX_HASHTAGS = 6;

/**
 * The kit as one block of text.
 *
 * Returns "" when there is nothing worth sending, so the caller can skip the
 * message rather than post an empty heading. Nothing is trimmed here — use
 * {@link uploadKitMessages} to send it, which splits rather than cuts.
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

  return [
    title === "" ? "" : `📝 TITLE\n${title}`,
    description === "" ? "" : `📄 DESCRIPTION\n${description}`,
    tags === "" ? "" : `🏷 TAGS\n${tags}`,
    hashtags === "" ? "" : `#️⃣ HASHTAGS\n${hashtags}`,
  ]
    .filter((block) => block !== "")
    .join("\n\n");
}

/**
 * The kit split into sendable messages.
 *
 * Telegram refuses a message over 4096 characters, and the obvious response —
 * trimming the description — is the wrong one: a full description is the point.
 * A documentary part published with two lines under it is undersold, and
 * cutting the description to fit a chat limit reintroduces exactly that. So the
 * text is SPLIT instead, on paragraph boundaries where it can be and mid-text
 * only when a single paragraph is itself too long.
 */
export function uploadKitMessages(fields: UploadKitFields): string[] {
  const kit = uploadKit(fields);
  if (kit === "") return [];
  if (kit.length <= MESSAGE_LIMIT) return [kit];

  const messages: string[] = [];
  let current = "";

  const flush = (): void => {
    if (current.trim() !== "") messages.push(current.trimEnd());
    current = "";
  };

  for (const paragraph of kit.split("\n\n")) {
    // A paragraph that cannot fit on its own has to be cut somewhere; cutting
    // it is still better than dropping it.
    if (paragraph.length > MESSAGE_LIMIT) {
      flush();
      for (let at = 0; at < paragraph.length; at += MESSAGE_LIMIT) {
        messages.push(paragraph.slice(at, at + MESSAGE_LIMIT));
      }
      continue;
    }
    if (current.length + paragraph.length + 2 > MESSAGE_LIMIT) flush();
    current += current === "" ? paragraph : `\n\n${paragraph}`;
  }
  flush();

  // Say which part of the kit this is, so a split does not read as a glitch.
  return messages.map((message, index) =>
    messages.length > 1 ? `${message}\n\n— ${index + 1}/${messages.length} —` : message,
  );
}

function clean(values: readonly string[], limit: number): string[] {
  return values
    .map((value) => value.trim())
    .filter((value) => value !== "")
    .slice(0, limit);
}
