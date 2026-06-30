import { optionalEnv } from "./env.js";
import { OUTPUT_DIRECTORIES } from "./constants.js";

/**
 * Runtime configuration — settings that are DERIVED from the environment when
 * the app starts. Unlike `constants.ts` (fixed forever) these can differ per
 * machine / deployment, but unlike raw env vars in `env.ts` they are cleaned up,
 * defaulted, and strongly typed for the rest of the app to consume.
 */

/** Which environment the app is running in. */
export type AppEnvironment = "development" | "staging" | "production";

/** Map a free-form env string onto our strict {@link AppEnvironment} union. */
function resolveEnvironment(): AppEnvironment {
  const raw = (optionalEnv("APP_ENV") ?? optionalEnv("NODE_ENV", "development")).toLowerCase();
  if (raw === "production" || raw === "prod") {
    return "production";
  }
  if (raw === "staging" || raw === "stage") {
    return "staging";
  }
  return "development";
}

/** Frozen, typed runtime settings with safe defaults (zero-config friendly). */
export const runtimeConfig = {
  /** development | staging | production. */
  environment: resolveEnvironment(),
  /** IANA timezone for date math + scheduling (e.g. "America/New_York"). */
  timezone: optionalEnv("STUDIO_TIMEZONE", "UTC"),
  /** Local folder where finished packages will be written (storage step, later). */
  outputDir: optionalEnv("STUDIO_OUTPUT_DIR", `./${OUTPUT_DIRECTORIES.root}`),
} as const;

/** The shape of {@link runtimeConfig}, for typing function signatures. */
export type RuntimeConfig = typeof runtimeConfig;
