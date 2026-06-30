/**
 * Centralised environment-variable access + validation.
 *
 * Why this file exists: instead of scattering `process.env.SOMETHING` all over
 * the codebase (easy to typo, fails with confusing errors), every secret is
 * read through one of these helpers. Required vars fail FAST with a clear
 * message, so a missing key is obvious in the logs instead of a mysterious
 * crash deep inside an API call.
 *
 * No real keys exist yet (we haven't added AI / Telegram / storage), so nothing
 * is required at import time. As you add integrations, read them with
 * `requireEnv("NAME")` inside the task that needs them.
 *
 * SECURITY: never log the *value* returned by these functions.
 */

/** Read a REQUIRED env var. Throws a clear error if it is missing or empty. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Add it to .env (local) and the Trigger.dev dashboard (staging + prod).`,
    );
  }
  return value;
}

// Overloads: when a fallback is given the result is always a string;
// without one it may be undefined. This keeps callers fully typed.
export function optionalEnv(name: string, fallback: string): string;
export function optionalEnv(name: string): string | undefined;
export function optionalEnv(name: string, fallback?: string): string | undefined {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  return value;
}

// NOTE: This file is ONLY about reading + validating raw environment variables.
// Derived runtime settings (timezone, output dir, environment name) live in
// `runtime.ts`; fixed values live in `constants.ts`. Keep those concerns apart.
