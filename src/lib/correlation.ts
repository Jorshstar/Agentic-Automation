import { randomUUID as nodeRandomUUID } from "node:crypto";

/**
 * Correlation IDs.
 *
 * A correlation ID is a single unique string that tags every log line of ONE
 * workflow run. When something goes wrong you can search that one id and see the
 * whole story across tasks/services. This utility is deliberately framework-
 * agnostic so any future agent (Trigger.dev task, script, edge function) can use
 * it without pulling in extra dependencies.
 */

/** Generate a UUID, preferring the cross-runtime Web Crypto API. */
function generateUuid(): string {
  const webCrypto = globalThis.crypto;
  if (webCrypto && typeof webCrypto.randomUUID === "function") {
    return webCrypto.randomUUID();
  }
  // Fallback for runtimes without a global `crypto` (older Node).
  return nodeRandomUUID();
}

/**
 * Create a unique correlation id for a workflow execution.
 *
 * @param prefix short label describing the workflow (default "wf").
 * @example newCorrelationId("daily-video") // "daily-video_3f9c...-..."
 */
export function newCorrelationId(prefix = "wf"): string {
  return `${prefix}_${generateUuid()}`;
}
