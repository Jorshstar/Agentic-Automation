/**
 * IS THE BOT ALIVE? — a read-only probe, safe to run at any time.
 *
 *   npm run bot:health
 *
 * Answers the question that otherwise costs a round trip to someone who can
 * read the logs: the bot is not responding — is it down, or did it answer and
 * do nothing?
 *
 *   `pending_update_count: 0`  something is consuming updates: the agent is up.
 *   a growing count            nobody is reading them: the agent is down.
 *   a non-empty `url`          a webhook is set, so getUpdates will never fire
 *                              and the local agent cannot see anything.
 *
 * It never calls getUpdates, because that CONSUMES updates — a diagnostic that
 * eats the message you were testing with is worse than no diagnostic.
 */
try {
  process.loadEnvFile();
} catch {
  /* ambient env */
}

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("TELEGRAM_BOT_TOKEN is not set — nothing to probe.");
  process.exit(1);
}

for (const method of ["getMe", "getWebhookInfo"] as const) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await response.json()) as { ok?: boolean; result?: unknown; description?: string };
    if (!body.ok) {
      console.log(`${method}: FAILED — ${body.description ?? response.status}`);
      continue;
    }
    const result = body.result as Record<string, unknown>;
    if (method === "getMe") {
      console.log(`bot: @${String(result["username"])} (${String(result["first_name"])})`);
    } else {
      const pending = Number(result["pending_update_count"] ?? 0);
      const webhook = String(result["url"] ?? "");
      console.log(`webhook: ${webhook === "" ? "none (polling)" : webhook}`);
      console.log(
        `pending updates: ${pending}` +
          (pending === 0
            ? "  → something is reading them; the agent is up"
            : "  → nobody is reading them; the agent is probably down"),
      );
    }
  } catch (error) {
    console.log(`${method}: unreachable — ${error instanceof Error ? error.message : String(error)}`);
  }
}
