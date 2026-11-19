#!/usr/bin/env bash
#
# STUDIO AUTOSTART — keeps the two always-on studio processes alive.
#
#   scripts/studio-autostart.sh
#
# It runs:
#   * the Telegram agent   (the chat brain — answers you, queues clip jobs)
#   * the clip worker      (drains the queue and actually makes the clips)
#
# Both are supervised: if one dies it is restarted after a short backoff, so a
# transient network failure or a provider hiccup cannot leave the bot silently
# dead. Output goes to logs/ with the date, and each start is stamped so you can
# see when something restarted.
#
# WHY A SUPERVISOR AND NOT JUST TWO COMMANDS: the agent is the only consumer of
# the bot's updates. If it exits and nothing notices, messages queue up forever
# and the bot looks broken with no error anywhere — which is exactly the failure
# we just debugged.
#
# ⚠️ Telegram allows only ONE consumer of a bot's updates. Do not run this while
# the cloud `telegram-ingest` schedule is deployed and active, or the two will
# steal each other's messages.

set -uo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$PROJECT_DIR/logs"
RESTART_DELAY=5
# Stop hammering a permanently broken process; after this many failures in a
# short window we slow right down instead of spinning.
MAX_FAST_RESTARTS=5
SLOW_DELAY=60

mkdir -p "$LOG_DIR"
cd "$PROJECT_DIR" || exit 1

stamp() { date '+%Y-%m-%d %H:%M:%S'; }

log() {
  echo "[$(stamp)] $*" | tee -a "$LOG_DIR/autostart.log"
}

# --- preflight -------------------------------------------------------------
# Fail loudly HERE rather than letting each child die a confusing death later.
preflight_failed=0

if [ ! -f "$PROJECT_DIR/.env" ]; then
  log "FATAL: no .env in $PROJECT_DIR — the studio cannot authenticate."
  preflight_failed=1
fi

if ! command -v node >/dev/null 2>&1; then
  log "FATAL: node is not on PATH."
  preflight_failed=1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  # The agent can still chat without ffmpeg, but no clip will ever render, so
  # say so plainly instead of letting every job fail one by one.
  log "WARNING: ffmpeg is not installed in WSL — clipping WILL fail."
  log "         Fix with:  sudo apt update && sudo apt install -y ffmpeg"
fi

if [ "$preflight_failed" -ne 0 ]; then
  log "Aborting."
  exit 1
fi

# --- supervision -----------------------------------------------------------
supervise() {
  local name="$1" script="$2"
  local logfile="$LOG_DIR/$name.log"
  local failures=0 started

  while true; do
    log "starting $name"
    started=$(date +%s)

    # Line-buffered through a timestamping filter so the log is readable.
    npm run --silent "$script" 2>&1 \
      | while IFS= read -r line; do echo "[$(stamp)] $line"; done >> "$logfile"

    local ran=$(( $(date +%s) - started ))
    if [ "$ran" -gt 60 ]; then
      failures=0           # it ran a while, so this is a fresh problem
    else
      failures=$(( failures + 1 ))
    fi

    if [ "$failures" -ge "$MAX_FAST_RESTARTS" ]; then
      log "$name failed $failures times quickly — backing off ${SLOW_DELAY}s (see $logfile)"
      sleep "$SLOW_DELAY"
      failures=0
    else
      log "$name exited after ${ran}s — restarting in ${RESTART_DELAY}s"
      sleep "$RESTART_DELAY"
    fi
  done
}

# Stop both children when this script is stopped, so nothing is orphaned.
cleanup() {
  log "shutting down"
  jobs -p | xargs -r kill 2>/dev/null
  exit 0
}
trap cleanup SIGINT SIGTERM

log "=== studio autostart (project: $PROJECT_DIR) ==="
supervise "telegram-agent" "studio:agent" &
supervise "clip-worker" "studio:clip-worker" &
wait
