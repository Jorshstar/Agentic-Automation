import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CaptionGenerationProvider } from "./caption-generation-provider.js";
import type {
  CaptionContext,
  CaptionGenerationRequest,
  CaptionCue,
  GeneratedCaptions,
  CaptionGenerationWarning,
  CaptionGenerationMetadata,
} from "./types.js";

/**
 * SubtitleCaptionProvider — builds .srt + styled .ass subtitles from the measured
 * voiceover timeline.
 *
 * Fully local: no AI, no network, no key. Deterministic text processing only. It
 * splits each measured segment into short cues and distributes the segment's real
 * time window across them proportionally by length, so captions stay in sync with
 * the narration. A per-segment issue becomes a structured warning, not a crash.
 */

const DEFAULT_CAPTION_CONTEXT: CaptionContext = {
  outputDir: "output/captions",
  width: 1080,
  height: 1920,
  fontName: "Arial",
  accentColor: "#FFFFFF",
  position: "bottom",
  karaoke: false,
};

export class SubtitleCaptionProvider implements CaptionGenerationProvider {
  readonly name = "subtitle-caption-provider";

  private lastResult: GeneratedCaptions | undefined;

  constructor(private readonly context: CaptionContext = DEFAULT_CAPTION_CONTEXT) {}

  /** The most recent captions produced (handy for demos/telemetry). */
  get last(): GeneratedCaptions | undefined {
    return this.lastResult;
  }

  async generate(request: CaptionGenerationRequest): Promise<GeneratedCaptions> {
    const context: CaptionContext = { ...this.context, ...request.context };
    await mkdir(context.outputDir, { recursive: true });

    const warnings: CaptionGenerationWarning[] = [];
    const cues: CaptionCue[] = [];
    let cueIndex = 0;

    for (const segment of request.voiceover.segments) {
      const text = segment.text.trim();
      if (text === "") {
        warnings.push({ code: "empty-segment", message: "Segment has no text.", segmentId: segment.segmentId });
        continue;
      }

      const window = segment.actualEndSecond - segment.actualStartSecond;
      if (window <= 0) {
        warnings.push({
          code: "zero-duration",
          message: "Segment has a zero-length window; captions skipped.",
          segmentId: segment.segmentId,
        });
        continue;
      }

      // ONE cue per SEGMENT, spanning that segment's EXACT measured audio window.
      // This is what actually keeps captions in sync with the voice: each segment
      // was synthesized and measured on its own, so its [start,end] is real. The
      // old per-sentence split guessed sentence timing by character length and
      // drifted. Segments are ~one sentence now, so the caption stays short.
      cues.push({
        index: ++cueIndex,
        segmentId: segment.segmentId,
        startSecond: round3(segment.actualStartSecond),
        endSecond: round3(segment.actualEndSecond),
        text,
      });
    }

    if (cues.length === 0) {
      warnings.push({ code: "empty-cue", message: "No caption cues were produced." });
    }

    const srt = renderSrt(cues);
    const ass = renderAss(cues, context);

    const srtPath = join(context.outputDir, "captions.srt");
    const assPath = join(context.outputDir, "captions.ass");
    await writeFile(srtPath, srt, "utf8");
    await writeFile(assPath, ass, "utf8");

    const metadata: CaptionGenerationMetadata = {
      provider: this.name,
      cueCount: cues.length,
      segmentCount: request.voiceover.segments.length,
      fontName: context.fontName,
      accentColor: context.accentColor,
      formats: ["srt", "ass"],
    };

    const result: GeneratedCaptions = {
      cues,
      srtPath,
      assPath,
      outputDir: context.outputDir,
      totalDurationSeconds: round3(request.voiceover.totalDurationSeconds),
      warnings,
      metadata,
    };
    this.lastResult = result;
    return result;
  }
}

/**
 * Split text into whole sentences (keeping terminal punctuation). A sentence is
 * never broken apart — it's shown as one cue and wraps across lines if long. If
 * there's no terminal punctuation, the whole text is one cue.
 */
function splitSentences(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed === "") {
    return [];
  }
  const matches = trimmed.match(/[^.!?]+[.!?]+["'”’)\]]*|[^.!?]+$/gu);
  if (!matches) {
    return [trimmed];
  }
  return matches.map((sentence) => sentence.trim()).filter((sentence) => sentence !== "");
}

/* --------------------------------- SRT --------------------------------- */

function renderSrt(cues: readonly CaptionCue[]): string {
  return (
    cues
      .map(
        (cue) =>
          `${cue.index}\n${srtTime(cue.startSecond)} --> ${srtTime(cue.endSecond)}\n${cue.text}\n`,
      )
      .join("\n") + "\n"
  );
}

function srtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const millis = ms % 1000;
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(millis, 3)}`;
}

/* --------------------------------- ASS --------------------------------- */

function renderAss(cues: readonly CaptionCue[], context: CaptionContext): string {
  // USER-TUNED: smaller text (~58px at 1920), sitting ~19% up from the bottom —
  // above TikTok's own caption/UI overlay, but nowhere near the middle.
  const fontSize = Math.round(context.height / 33);
  const marginH = Math.round(context.width * 0.08); // ~86px each side (keeps text on-screen)
  const marginV = Math.round(context.height * (context.position === "center" ? 0.42 : 0.19));
  const alignment = context.position === "center" ? 5 : 2; // 5=middle-center, 2=bottom-center
  const white = "&H00FFFFFF";
  const black = "&H00000000";
  const shadow = hexToAssColor(context.accentColor, "40"); // accent-tinted glow behind text
  // Karaoke: words start as SecondaryColour (white) and flip to PrimaryColour
  // (the niche accent) as they are spoken. Non-karaoke: plain white throughout.
  const primary = context.karaoke ? hexToAssColor(context.accentColor) : white;

  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${context.width}`,
    `PlayResY: ${context.height}`,
    // WrapStyle 0 = smart wrapping (auto line breaks, roughly balanced lines).
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${context.fontName},${fontSize},${primary},${white},${black},${shadow},1,0,0,0,100,100,0,0,1,5,3,${alignment},${marginH},${marginH},${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");

  const events = cues
    .map((cue) => {
      const body = context.karaoke ? karaokeText(cue) : assText(cue.text);
      return `Dialogue: 0,${assTime(cue.startSecond)},${assTime(cue.endSecond)},Default,,0,0,0,,${body}`;
    })
    .join("\n");

  return `${header}\n${events}\n`;
}

/**
 * Build a karaoke (`\k`) cue: the full sentence is visible the whole time, and
 * each word flips to the accent as it is spoken. We don't have word-level TTS
 * timestamps, so each word's duration is estimated proportionally to its length
 * within the cue's real window — visually indistinguishable at caption pace.
 */
function karaokeText(cue: CaptionCue): string {
  const words = cue.text.split(/\s+/u).filter((word) => word !== "");
  if (words.length === 0) {
    return assText(cue.text);
  }
  const totalCs = Math.max(1, Math.round((cue.endSecond - cue.startSecond) * 100));
  const weights = words.map((word) => Math.max(word.length, 2));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  let spent = 0;
  return words
    .map((word, i) => {
      const isLast = i === words.length - 1;
      const cs = isLast
        ? Math.max(1, totalCs - spent)
        : Math.max(1, Math.round(((weights[i] ?? 2) / totalWeight) * totalCs));
      spent += cs;
      return `{\\k${cs}}${word.replace(/[{}]/gu, "")}`;
    })
    .join(" ");
}

function assTime(seconds: number): string {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360_000);
  const m = Math.floor((cs % 360_000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const centis = cs % 100;
  return `${h}:${pad(m, 2)}:${pad(s, 2)}.${pad(centis, 2)}`;
}

/** Escape text for an ASS Dialogue line. */
function assText(text: string): string {
  return text.replace(/\r?\n/gu, "\\N").replace(/[{}]/gu, "");
}

/** Convert "#RRGGBB" to an ASS colour "&HAABBGGRR" (default alpha 00 = opaque). */
function hexToAssColor(hex: string, alpha = "00"): string {
  const cleaned = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/u.test(cleaned)) {
    return `&H${alpha}FFFFFF`;
  }
  const r = cleaned.slice(0, 2);
  const g = cleaned.slice(2, 4);
  const b = cleaned.slice(4, 6);
  return `&H${alpha}${b}${g}${r}`.toUpperCase();
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
