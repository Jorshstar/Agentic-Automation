# Agentic Automation

Production-ready AI automations built on [Trigger.dev](https://trigger.dev) v4 + TypeScript.

## Overview

This repository hosts background-job automations. Each automation lives in its own
folder under `src/trigger/` and runs as a Trigger.dev task (scheduled, event-driven,
or triggered manually).

## Prerequisites

- Node.js 20+ (you have v22)
- A free Trigger.dev account and a project at [cloud.trigger.dev](https://cloud.trigger.dev)

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Add your project ref to trigger.config.ts (replace REPLACE_WITH_YOUR_PROJECT_REF)

# 3. Log in to the Trigger.dev CLI (opens a browser once)
npx trigger.dev@latest login

# 4. Start the local dev server
npm run dev
```

## Project Structure

```
src/trigger/
  example/
    hello-world.ts     ← starter task (safe to delete)
trigger.config.ts      ← project ref, runtime, retries, task dirs
.env                   ← local secrets (git-ignored)
.env.example           ← template for required env vars
```

## Environment Variables

- Real secrets live in `.env` (git-ignored).
- Every key in `.env` must also be added in the Trigger.dev dashboard
  (your project → Environment Variables) for **both** staging and prod, or
  production runs will fail.
- Never log secret values; never hardcode credentials.

## Scripts

| Command           | What it does                          |
| ----------------- | ------------------------------------- |
| `npm run dev`     | Start the Trigger.dev dev server      |
| `npm run deploy`  | Deploy tasks to production            |
| `npm run typecheck` | Type-check without emitting files   |

## Testing

1. `npm run dev`
2. Open the dashboard → Test tab → run `hello-world` with `{ "name": "Ada" }`
3. Confirm the run succeeds and returns a greeting.

## Deployment

Deploy only after a successful local test **and** explicit approval:

```bash
npm run deploy
```

## Troubleshooting

- **Missing env var in production** — added to `.env` but not the dashboard.
- **Import path errors** — TypeScript task-to-task imports need a `.js` extension.
- **API auth failures** — wrong key format, expired key, or wrong header name.
```
