#!/usr/bin/env bash
# Starts everything for local development: the database, then the web API, the web page and the
# bot, with their output in one terminal. Ctrl+C stops the three processes. The database keeps
# running, so its data survives between sessions.
#
#   pnpm dev                     the normal start
#   pnpm dev --deploy-commands   also register the slash commands in your test server first
#   pnpm dev --setup-only        start the database and migrate, then stop
#   pnpm dev --stop-db           stop the database container and exit
set -euo pipefail

DB_NAME=spinnerbot-dev-db
DB_IMAGE=docker.io/library/postgres:18.6-alpine3.24
DB_WAIT_SECONDS=30

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DEPLOY_COMMANDS=false
SETUP_ONLY=false
STOP_DB=false
for arg in "$@"; do
  case "$arg" in
    --) ;;
    --deploy-commands) DEPLOY_COMMANDS=true ;;
    --setup-only) SETUP_ONLY=true ;;
    --stop-db) STOP_DB=true ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '\n== %s\n' "$*"; }
die() { echo "Error: $*" >&2; exit 1; }

if $STOP_DB; then
  podman stop "$DB_NAME" 2>/dev/null && echo "Stopped $DB_NAME" || echo "$DB_NAME was not running"
  exit 0
fi

[ -f .env ] || die ".env is missing. Copy .env.example to .env and fill it in (see README.md)."
command -v podman >/dev/null || die "podman is not installed."
[ -d node_modules ] || die "Dependencies are missing. Run: pnpm install"

# The database is a throwaway container, so it may need creating. Its data survives restarts of
# this script, and is lost only when the container is stopped.
say "Database"
if podman ps --format '{{.Names}}' | grep -qx "$DB_NAME"; then
  echo "$DB_NAME is already running"
else
  podman run -d --rm --name "$DB_NAME" \
    -e POSTGRES_PASSWORD=scrimbot -e POSTGRES_USER=scrimbot -e POSTGRES_DB=scrimbot \
    -p 127.0.0.1:5432:5432 "$DB_IMAGE" >/dev/null
  echo "Started $DB_NAME"
fi

for ((waited = 0; waited < DB_WAIT_SECONDS; waited++)); do
  if podman exec "$DB_NAME" pg_isready -U scrimbot -d scrimbot -q 2>/dev/null; then break; fi
  sleep 1
done
podman exec "$DB_NAME" pg_isready -U scrimbot -d scrimbot -q 2>/dev/null \
  || die "The database did not accept connections within ${DB_WAIT_SECONDS}s. Try: podman logs $DB_NAME"

# Migrations and the dev servers load the shared packages from their built output.
say "Building shared packages"
pnpm exec tsc -b

say "Migrating"
pnpm db:migrate

# Production runs the web and bot as restricted roles. Do the same here, so a missing permission
# shows up now and not after a deploy.
say "Database roles"
pnpm db:dev-roles

if $DEPLOY_COMMANDS; then
  say "Registering slash commands"
  pnpm commands:deploy
fi

$SETUP_ONLY && { echo "Setup done."; exit 0; }

# Two copies of the bot would both answer every command, so refuse to start a second one.
if pgrep -f "tsx.* src/main.ts" >/dev/null; then
  die "A bot is already running (pnpm dev:bot or another pnpm dev). Stop it first."
fi

public_url="$(grep -E '^PUBLIC_URL=' .env | tail -1 | cut -d= -f2- || true)"
say "Starting web API, web page and bot (Ctrl+C stops them)"
echo "Roster links point at: ${public_url:-<PUBLIC_URL is not set>}"

# Stops this script's whole process group, which is the three servers and their output filters.
trap 'trap - INT TERM EXIT; echo; echo "Stopping..."; kill 0 2>/dev/null || true' INT TERM EXIT

run() {
  local label="$1"
  shift
  ("$@" 2>&1 | sed -u "s/^/[$label] /") &
}
# The owner's URL from .env, rewritten to log in as the given role.
WEB_URL="$(pnpm --silent --filter @scrimbot/bot role-url scrimbot_web)"
BOT_URL="$(pnpm --silent --filter @scrimbot/bot role-url scrimbot_bot)"

# A value set in the environment wins over .env, so these two run as their own roles.
DATABASE_URL="$WEB_URL" run api pnpm --filter @scrimbot/web dev:server
run web pnpm dev:web --host
DATABASE_URL="$BOT_URL" run bot pnpm dev:bot

# If any one of them exits, stop the rest so the failure is visible rather than half-running.
wait -n || true
echo "A process exited, so everything is being stopped."
