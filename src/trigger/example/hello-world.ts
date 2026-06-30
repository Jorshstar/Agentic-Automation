import { logger, task } from "@trigger.dev/sdk";

/**
 * A minimal example task to confirm the project is wired up correctly.
 *
 * Once your dev server is running you can fire this from the Trigger.dev
 * dashboard (Test tab) with a payload like: { "name": "Ada" }.
 *
 * Delete this folder once you build your first real automation.
 */
export const helloWorld = task({
  id: "hello-world",
  // Per-task retry override (the global default in trigger.config.ts also applies).
  retry: {
    maxAttempts: 3,
  },
  run: async (payload: { name?: string }) => {
    const name = payload.name?.trim() || "world";

    logger.info("hello-world task started", { name });

    const greeting = `Hello, ${name}! Your Trigger.dev project is working. 🎉`;

    logger.info("hello-world task finished", { greeting });

    return { greeting };
  },
});
