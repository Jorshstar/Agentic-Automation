/**
 * Tiny structured logger.
 *
 * Every log line is a single JSON object with a level, message, timestamp and
 * optional context. Structured logs are easy for humans to read AND for tools
 * (Trigger.dev, log dashboards) to search and filter.
 *
 * Works anywhere — inside Trigger.dev tasks and in plain utility functions.
 * (Inside a task you can also use the SDK's own `logger` for run-attached logs;
 * this one is for shared code that runs outside a single run's context.)
 *
 * SECURITY: never pass secret values (API keys, tokens) into `context`.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

/** Arbitrary extra fields attached to a log line. Keep it free of secrets. */
export type LogContext = Record<string, unknown>;

function emit(level: LogLevel, message: string, context?: LogContext): void {
  const entry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...(context ? { context } : {}),
  };

  const line = JSON.stringify(entry);

  // Route to the matching console method so levels survive in real log systems.
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (message: string, context?: LogContext): void => emit("debug", message, context),
  info: (message: string, context?: LogContext): void => emit("info", message, context),
  warn: (message: string, context?: LogContext): void => emit("warn", message, context),
  error: (message: string, context?: LogContext): void => emit("error", message, context),
} as const;

/** The logger's type, so other modules (e.g. WorkflowContext) can accept one. */
export type Logger = typeof logger;
