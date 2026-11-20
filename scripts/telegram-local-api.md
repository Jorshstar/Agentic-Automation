# Local Telegram Bot API server (lifts uploads from 20 MB to 2 GB)

Telegram's own Bot API refuses to hand a bot any file over **20 MB** — roughly
three minutes of phone video. Running Telegram's `telegram-bot-api` server
yourself raises that to **2000 MB**, and it serves files from local disk rather
than over HTTP, so a large video never travels twice.

This is the only way to send a big file *through Telegram*. If the file is
already on the machine, the watch folder (`input/`) has no limit at all and
needs none of this.

## 1. Get an api_id and api_hash

These identify the *application*, not your bot, and are separate from
`TELEGRAM_BOT_TOKEN`.

1. Sign in at <https://my.telegram.org> with your phone number.
2. Open **API development tools** and create an application (any name).
3. Copy the `api_id` and `api_hash`.

Treat them like any other secret: they belong in `.env`, never in a commit.

## 2. Run the server

Docker is the least painful option:

```bash
docker run -d --name telegram-bot-api --restart unless-stopped \
  -p 8081:8081 \
  -v telegram-bot-api-data:/var/lib/telegram-bot-api \
  -e TELEGRAM_API_ID=<your api_id> \
  -e TELEGRAM_API_HASH=<your api_hash> \
  aiogram/telegram-bot-api:latest \
  --local
```

`--local` is the flag that enables large files and local-path responses. Without
it you gain nothing over Telegram's servers.

## 3. Point the studio at it

Add to `.env`:

```
TELEGRAM_API_BASE=http://localhost:8081
```

That is the whole code change — `TelegramClient` builds its URLs from this, and
the download limit follows automatically.

## 4. Important: the bot must be logged out of the cloud first

A bot can only talk to one Bot API server at a time. Before switching, call
`logOut` against Telegram's servers so the bot is released:

```bash
curl -s "https://api.telegram.org/bot<TOKEN>/logOut"
```

Then start the local server. To go back, call `logOut` on the LOCAL server
(`http://localhost:8081/bot<TOKEN>/logOut`) and remove `TELEGRAM_API_BASE`.

Skipping this is the usual reason the bot goes silent after switching.

## 5. Check it worked

```bash
npm run studio:agent:test     # the brain still answers
```

Then send the bot a video over 20 MB. The worker reports the real size instead
of refusing it.

## Gotchas

- **Disk use.** The server keeps every downloaded file under
  `/var/lib/telegram-bot-api`. It does not clean up on its own; prune the volume
  periodically.
- **Docker on Windows.** `localhost:8081` works from the host, but the file
  paths the server returns are paths *inside the container*. Either run the
  server natively, or bind-mount a host directory at the same path so the worker
  can read them.
- **Still 2 GB, not unlimited.** Past that, use the watch folder.
