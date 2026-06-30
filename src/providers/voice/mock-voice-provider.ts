import type { VoiceProvider } from "./voice-provider.js";
import type {
  VoiceGenerationRequest,
  VoiceGenerationResult,
  VoicePauseMarker,
  VoiceEmphasis,
  EstimateDurationRequest,
  EstimateDurationResult,
  VoiceValidation,
} from "./types.js";

/** Average speaking rate (words per second) used for duration estimates. */
const WORDS_PER_SECOND = 2.5;

/**
 * MockVoiceProvider — returns FAKE but realistic voice direction (metadata).
 *
 * No audio is generated, no files are written, no network/API key is used. It
 * just describes HOW the narration should be spoken, so the VoiceAgent can be
 * built and tested before any real text-to-speech service is wired in.
 */
export class MockVoiceProvider implements VoiceProvider {
  readonly name = "mock-voice-provider";

  async generateVoiceover(request: VoiceGenerationRequest): Promise<VoiceGenerationResult> {
    const text = request.script.trim();
    const words = text.split(/\s+/u);
    const speed = 1;
    const seconds = Math.max(1, Math.round(words.length / WORDS_PER_SECOND));

    // Pause briefly after the first few sentence endings.
    const pauses: VoicePauseMarker[] = words
      .map((word, index) => ({ word, index }))
      .filter(({ word }) => /[.!?]$/u.test(word))
      .slice(0, 3)
      .map(({ index }) => ({ afterWordIndex: index, durationMs: 350 }));

    // Emphasise the first few longer, "interesting" words.
    const emphasisMarkers: VoiceEmphasis[] = words
      .map((word) => word.replace(/[^\p{L}\p{N}'-]/gu, ""))
      .filter((word) => word.length > 6)
      .slice(0, 3)
      .map((word) => ({ text: word, level: "strong" }));

    // Flag very long words for careful pronunciation.
    const pronunciationNotes = Array.from(
      new Set(
        words
          .map((word) => word.replace(/[^\p{L}\p{N}'-]/gu, ""))
          .filter((word) => word.length > 11),
      ),
    )
      .slice(0, 2)
      .map((word) => `Pronounce "${word}" clearly and slightly slower.`);

    return {
      narrationText: text,
      speaker: "Aria (warm female narrator)",
      voiceId: "mock-voice-aria-v1",
      language: request.language ?? "en-US",
      speakingStyle: request.tone ?? "energetic-explainer",
      speed,
      durationSeconds: seconds,
      estimatedAudioLengthSeconds: seconds,
      pronunciationNotes,
      pauses,
      emphasisMarkers,
    };
  }

  async estimateDuration(request: EstimateDurationRequest): Promise<EstimateDurationResult> {
    const words = request.text.trim().split(/\s+/u).length;
    const speed = request.speed && request.speed > 0 ? request.speed : 1;
    return { seconds: Math.max(1, Math.round(words / WORDS_PER_SECOND / speed)) };
  }

  async validateNarration(text: string): Promise<VoiceValidation> {
    const trimmed = text.trim();
    const issues: string[] = [];
    if (trimmed.length === 0) {
      issues.push("Narration text is empty.");
    } else if (trimmed.split(/\s+/u).length < 10) {
      issues.push("Narration is very short for a 60-second video.");
    }
    return { valid: issues.length === 0, issues };
  }
}
