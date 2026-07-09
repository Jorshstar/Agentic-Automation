import { defineConfig } from "@trigger.dev/sdk";
import { ffmpeg } from "@trigger.dev/build/extensions/core";

/**
 * Trigger.dev project configuration.
 *
 * The `project` value below is your project "ref" from the Trigger.dev
 * dashboard (cloud.trigger.dev → your project → Settings). It looks like
 * `proj_xxxxxxxxxxxxxxxxxxxx`. Replace the placeholder before running `dev`
 * or `deploy`.
 *
 * Docs: https://trigger.dev/docs/config/config-file
 */
export default defineConfig({
  // Your Trigger.dev project ref (cloud.trigger.dev → Content Studio).
  project: "proj_lnmwstqoufqzlssjxrpz",

  // Standard Node runtime.
  runtime: "node",

  // How chatty the logs are: "log" is a good default; use "debug" when hunting bugs.
  logLevel: "log",

  // Safety net: kill any single run that exceeds 1 hour so a hung task can't bill forever.
  maxDuration: 3600,

  // Global retry policy applied to every task unless a task overrides it.
  // Network/API hiccups are common, so retries are essential for reliability.
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1_000,
      maxTimeoutInMs: 10_000,
      factor: 2,
      randomize: true,
    },
  },

  // Where Trigger.dev looks for your task files.
  dirs: ["./src/trigger"],

  // Install ffmpeg + ffprobe in the deployed container (Composition, Music, QA,
  // Voice all shell out to them). Without this, the cloud image has no ffmpeg.
  build: {
    extensions: [ffmpeg()],
  },
});
