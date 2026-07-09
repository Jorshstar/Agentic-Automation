/**
 * Delivery types — the final stage: getting the finished video to the user.
 *
 * On the cloud the rendered files are ephemeral, so delivery pushes the MP4 (and
 * optional sidecar files like the manifest) out to a channel. Provider-agnostic:
 * Telegram today, email/Drive later, behind the same interface. Graceful — if the
 * channel isn't configured, it returns a warning instead of failing the run.
 */

export interface DeliveryContext {
  /** Also attach sidecar documents (e.g. manifest.json) after the video. */
  readonly sendDocuments: boolean;
}

export interface DeliveryRequest {
  readonly videoPath: string;
  /** The message/caption to send with the video (title, hook, hashtags). */
  readonly caption: string;
  /** Optional extra files to attach (e.g. manifest.json, captions.srt). */
  readonly documents?: readonly string[];
  readonly context?: Partial<DeliveryContext>;
}

export type DeliveryWarningCode = "not-configured" | "missing-file" | "too-large" | "send-failed";

export interface DeliveryWarning {
  readonly code: DeliveryWarningCode;
  readonly message: string;
}

export interface DeliveryResult {
  readonly delivered: boolean;
  readonly provider: string;
  readonly videoSent: boolean;
  readonly documentsSent: number;
  readonly warnings: readonly DeliveryWarning[];
}
