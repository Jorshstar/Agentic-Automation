/**
 * Timing helpers.
 *
 * A tiny stopwatch: call `startTimer()` to begin, then `.finish()` to get the
 * elapsed time. It only measures — no logging, no side effects — so it is safe
 * to reuse anywhere.
 */

/** The numbers produced when a timer is stopped. */
export interface TimingResult {
  /** Epoch milliseconds when timing began. */
  readonly startedAt: number;
  /** Epoch milliseconds when timing ended. */
  readonly finishedAt: number;
  /** How long elapsed, in milliseconds. */
  readonly durationMs: number;
}

/** A running stopwatch. Call `finish()` once to read the result. */
export interface Timer {
  readonly startedAt: number;
  finish(): TimingResult;
}

/** Start a stopwatch. */
export function startTimer(): Timer {
  const startedAt = Date.now();
  return {
    startedAt,
    finish(): TimingResult {
      const finishedAt = Date.now();
      return { startedAt, finishedAt, durationMs: finishedAt - startedAt };
    },
  };
}
