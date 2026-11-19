/**
 * CAPTION RENDERING (ASS subtitle generation).
 *
 * Short-form captions are not a transcript — they are a retention device. The
 * rules that actually move watch-time, and which this module implements:
 *
 *   1. SHORT LINES. 2-3 words max. Long lines force the eye to scan sideways
 *      instead of staying on the subject's face. The old build used 4 words on
 *      a 1080px-wide frame, which wrapped and jittered.
 *   2. ONE ACTIVE WORD. The word being spoken is colour-highlighted and pops
 *      ~12% larger for a beat. This is what makes captions feel "alive" and is
 *      the single most copied detail in the category.
 *   3. BIG TYPE. ~1/17th of frame height, bold, heavy outline plus shadow so it
 *      survives any background.
 *   4. SAFE ZONES. Captions sit clear of the platform UI: TikTok/Reels put
 *      controls and text in the bottom ~18% and the right edge.
 *
 * Output is a single .ass file per clip containing both the captions and the
 * optional hook card, so rendering stays one ffmpeg filter.
 */

import type { TranscriptWord } from "./transcribe.js";

export interface CaptionWord {
  readonly word: string;
  /** Seconds from the START of the clip (not the source video). */
  readonly start: number;
  readonly end: number;
}

export type CaptionPresetName = "bold-yellow" | "clean-white" | "impact-red";

interface CaptionPreset {
  readonly fontName: string;
  /** Frame height is divided by this to get the font size. */
  readonly sizeDivisor: number;
  /** ASS colour (&HAABBGGRR) for words not currently being spoken. */
  readonly baseColour: string;
  /** ASS colour for the word being spoken right now. */
  readonly highlightColour: string;
  readonly outlineColour: string;
  readonly outline: number;
  readonly shadow: number;
  readonly uppercase: boolean;
  /** Percent to scale the active word to, e.g. 112 = 12% bigger. */
  readonly popPercent: number;
  readonly maxWordsPerLine: number;
  readonly maxCharsPerLine: number;
}

/**
 * ASS colours are &HAABBGGRR — alpha, then BLUE, GREEN, RED. Getting that order
 * backwards is the classic bug here, so each value notes its hex equivalent.
 */
const PRESETS: Readonly<Record<CaptionPresetName, CaptionPreset>> = {
  /** Default. High-contrast yellow highlight — the familiar short-form look. */
  "bold-yellow": {
    fontName: "Arial",
    sizeDivisor: 17,
    baseColour: "&H00FFFFFF", // #FFFFFF
    highlightColour: "&H004DE1FF", // #FFE14D
    outlineColour: "&H00000000", // #000000
    outline: 5,
    shadow: 2,
    uppercase: true,
    popPercent: 112,
    maxWordsPerLine: 3,
    maxCharsPerLine: 20,
  },
  /** For emotional / educational content, where shouting type undercuts the message. */
  "clean-white": {
    fontName: "Arial",
    sizeDivisor: 19,
    baseColour: "&H00D8D8D8", // #D8D8D8
    highlightColour: "&H00FFFFFF", // #FFFFFF
    outlineColour: "&H00000000",
    outline: 4,
    shadow: 2,
    uppercase: false,
    popPercent: 107,
    maxWordsPerLine: 3,
    maxCharsPerLine: 24,
  },
  /** For sports and conflict — loud, urgent. */
  "impact-red": {
    fontName: "Arial",
    sizeDivisor: 16,
    baseColour: "&H00FFFFFF", // #FFFFFF
    highlightColour: "&H00303BFF", // #FF3B30
    outlineColour: "&H00000000",
    outline: 6,
    shadow: 3,
    uppercase: true,
    popPercent: 116,
    maxWordsPerLine: 2,
    maxCharsPerLine: 16,
  },
};

export interface BuildAssInput {
  readonly words: readonly CaptionWord[];
  readonly width: number;
  readonly height: number;
  readonly preset: CaptionPresetName;
  /** Optional hook burned across the top for the first couple of seconds. */
  readonly hook?: string;
  /** Total clip length, used to clamp event times. */
  readonly durationSeconds: number;
}

/**
 * Fraction of frame height kept clear at the bottom.
 *
 * On a VERTICAL clip this has to clear the platform UI, which occupies roughly
 * the bottom fifth on TikTok and Reels. On a LANDSCAPE clip there is no such
 * overlay, and lifting the text a quarter of the way up the frame would park it
 * across the middle of the picture, so it sits much lower.
 */
const BOTTOM_SAFE_VERTICAL = 0.24;
const BOTTOM_SAFE_LANDSCAPE = 0.1;
/** Fraction kept clear at the top (platform header / our hook card). */
const TOP_SAFE_VERTICAL = 0.13;
const TOP_SAFE_LANDSCAPE = 0.07;
/** How long the hook card stays on screen. */
const HOOK_SECONDS = 2.4;
/** A pause longer than this ends a caption line even if it is short. */
const LINE_BREAK_PAUSE = 0.5;
/** The pop animation runs over this many milliseconds, up then back. */
const POP_MS = 90;

export function buildAss(input: BuildAssInput): string {
  const preset = PRESETS[input.preset] ?? PRESETS["bold-yellow"];
  // Text is sized against frame HEIGHT so it scales with the picture. A
  // landscape frame is short, so the same divisor leaves the text looking
  // undersized next to a much wider picture — hence the boost.
  const LANDSCAPE_TEXT_BOOST = 1.25;
  const divisor =
    input.width >= input.height ? preset.sizeDivisor / LANDSCAPE_TEXT_BOOST : preset.sizeDivisor;
  const fontSize = Math.round(input.height / divisor);
  const hookSize = Math.round(fontSize * 0.82);
  const marginH = Math.round(input.width * 0.07);
  // Landscape and vertical need different safe areas; see the constants above.
  const landscape = input.width >= input.height;
  const marginBottom = Math.round(
    input.height * (landscape ? BOTTOM_SAFE_LANDSCAPE : BOTTOM_SAFE_VERTICAL),
  );
  const marginTop = Math.round(input.height * (landscape ? TOP_SAFE_LANDSCAPE : TOP_SAFE_VERTICAL));

  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${input.width}`,
    `PlayResY: ${input.height}`,
    "WrapStyle: 2", // no automatic wrapping — we control line breaks ourselves
    "ScaledBorderAndShadow: yes",
    "YCbCr Matrix: TV.709",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, " +
      "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, " +
      "Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    // Alignment 2 = bottom-centre; MarginV is measured up from the bottom edge.
    `Style: Caption,${preset.fontName},${fontSize},${preset.baseColour},${preset.highlightColour},` +
      `${preset.outlineColour},&H96000000,1,0,0,0,100,100,1,0,1,${preset.outline},${preset.shadow},` +
      `2,${marginH},${marginH},${marginBottom},1`,
    // Alignment 8 = top-centre; MarginV is measured down from the top edge.
    `Style: Hook,${preset.fontName},${hookSize},${preset.baseColour},${preset.highlightColour},` +
      `${preset.outlineColour},&H96000000,1,0,0,0,100,100,1,0,1,${Math.max(4, preset.outline - 1)},` +
      `${preset.shadow},8,${marginH},${marginH},${marginTop},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");

  const events: string[] = [];

  if (input.hook && input.hook.trim() !== "") {
    events.push(
      hookEvent(
        input.hook,
        preset,
        Math.min(HOOK_SECONDS, input.durationSeconds),
        // Characters that actually FIT: a fixed 22 overflowed a 576px-wide
        // frame and the title ran off both edges.
        maxHookChars(input.width - marginH * 2, hookSize),
      ),
    );
  }
  events.push(...captionEvents(input.words, preset, input.durationSeconds));

  return `${header}\n${events.join("\n")}\n`;
}

/* ------------------------------- captions ------------------------------- */

/**
 * One event PER WORD, each showing its whole line with that word highlighted.
 * This is more events than per-line karaoke but it is what produces a true
 * highlight-and-pop rather than a colour sweep, and libass handles a few hundred
 * events without effort.
 */
function captionEvents(
  words: readonly CaptionWord[],
  preset: CaptionPreset,
  duration: number,
): string[] {
  const lines = groupLines(words, preset);
  const events: string[] = [];

  for (const line of lines) {
    const rendered = line.map((w) => sanitize(preset.uppercase ? w.word.toUpperCase() : w.word));
    const lineEnd = line.at(-1)!.end;

    for (const [index, word] of line.entries()) {
      const start = clamp(word.start, 0, duration);
      // Hold each word until the NEXT one begins, so the line never blinks out
      // in the micro-gaps between words.
      const nextStart = line[index + 1]?.start ?? lineEnd;
      const end = clamp(Math.max(nextStart, word.end), start + 0.04, duration);
      if (end <= start) continue;

      const body = rendered
        .map((text, i) => (i === index ? highlight(text, preset) : text))
        .join(" ");
      events.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Caption,,0,0,0,,${body}`);
    }
  }
  return events;
}

/** Wrap the active word in its highlight colour plus a quick scale pop. */
function highlight(text: string, preset: CaptionPreset): string {
  const pop = preset.popPercent;
  return (
    `{\\c${preset.highlightColour}` +
    `\\t(0,${POP_MS},\\fscx${pop}\\fscy${pop})` +
    `\\t(${POP_MS},${POP_MS * 2},\\fscx100\\fscy100)}` +
    `${text}{\\r}`
  );
}

/**
 * Break the word stream into caption lines. A line ends when it hits the word
 * cap, would exceed the character cap, or the speaker pauses — so lines land on
 * natural phrase boundaries instead of arbitrary counts.
 */
export function groupLines(words: readonly CaptionWord[], preset: CaptionPreset): CaptionWord[][] {
  const lines: CaptionWord[][] = [];
  let current: CaptionWord[] = [];
  let chars = 0;

  for (const word of words) {
    const text = word.word.trim();
    if (text === "") continue;

    if (current.length > 0) {
      const previous = current.at(-1)!;
      const pause = word.start - previous.end;
      const wouldOverflow = chars + text.length + 1 > preset.maxCharsPerLine;
      if (current.length >= preset.maxWordsPerLine || wouldOverflow || pause > LINE_BREAK_PAUSE) {
        lines.push(current);
        current = [];
        chars = 0;
      }
    }
    current.push({ ...word, word: text });
    chars += text.length + 1;
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

/* --------------------------------- hook --------------------------------- */

/**
 * How many characters fit on one line at this font size. 0.55em is a reasonable
 * average advance width for a bold sans face; erring small keeps text inside the
 * frame, which matters more than packing the line.
 */
function maxHookChars(usableWidth: number, fontSize: number): number {
  return Math.max(8, Math.floor(usableWidth / (fontSize * 0.55)));
}

function hookEvent(hook: string, preset: CaptionPreset, seconds: number, maxChars: number): string {
  const text = wrapHook(sanitize(preset.uppercase ? hook.toUpperCase() : hook), maxChars);
  // Fade in fast, out slower, so it never fights the first spoken words.
  return `Dialogue: 1,${assTime(0)},${assTime(seconds)},Hook,,0,0,0,,{\\fad(220,320)}${text}`;
}

/** Break a hook into at most three balanced lines using ASS's hard break. */
function wrapHook(hook: string, maxChars = 22): string {
  const words = hook.split(/\s+/u).filter((w) => w !== "");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current === "") {
      current = word;
    } else if (current.length + word.length + 1 <= maxChars) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== "") lines.push(current);
  return lines.slice(0, 3).join("\\N");
}

/* -------------------------------- helpers -------------------------------- */

/**
 * Strip the characters that would be read as ASS markup or break the line
 * format. Braces open override blocks and a backslash starts a tag, so both must
 * go; newlines would terminate the Dialogue line entirely.
 */
function sanitize(text: string): string {
  return text
    .replace(/[{}\\]/gu, "")
    .replace(/\r?\n/gu, " ")
    .trim();
}

/** Convert seconds to ASS's h:mm:ss.cc timestamp. */
export function assTime(seconds: number): string {
  const centiseconds = Math.max(0, Math.round(seconds * 100));
  const hours = Math.floor(centiseconds / 360_000);
  const minutes = Math.floor((centiseconds % 360_000) / 6000);
  const secs = Math.floor((centiseconds % 6000) / 100);
  const centis = centiseconds % 100;
  return `${hours}:${pad(minutes)}:${pad(secs)}.${pad(centis)}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Re-base source-timeline words onto a clip's local timeline, keeping only the
 * words that actually fall inside the clip.
 */
export function toCaptionWords(
  words: readonly TranscriptWord[],
  startSecond: number,
  endSecond: number,
): CaptionWord[] {
  const duration = Math.max(0, endSecond - startSecond);
  return words
    .filter((w) => w.end > startSecond && w.start < endSecond)
    .map((w) => ({
      word: w.word.trim(),
      start: clamp(w.start - startSecond, 0, duration),
      end: clamp(w.end - startSecond, 0, duration),
    }))
    .filter((w) => w.word !== "" && w.end > w.start);
}
