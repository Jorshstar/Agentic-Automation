import type { BaseAgent } from "../base-agent.js";

/** Notifies the user that a package is ready (e.g. via Telegram, later). */
export interface NotificationInput {
  readonly summary: string;
  /** Links to the finished video/metadata. */
  readonly links: readonly string[];
}

export interface NotificationOutput {
  readonly delivered: boolean;
}

export interface NotificationAgent extends BaseAgent<NotificationInput, NotificationOutput> {
  readonly name: "notification-agent";
}
