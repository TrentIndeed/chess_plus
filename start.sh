#!/usr/bin/env bash
# Start Chess Plus — no flags needed. Safe to run repeatedly:
# installs anything missing and restarts any instance already running.
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-5173}"

if ! command -v npm >/dev/null 2>&1; then
  echo "✗ npm not found. Install Node.js 18+ from https://nodejs.org and re-run ./start.sh"
  exit 1
fi

# Install dependencies on first run or after a pull that changed them.
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  echo "→ Installing dependencies (first run can take a minute)…"
  npm install
fi

# Ensure the Stockfish engine assets are in place (postinstall normally
# handles this; re-create them if they were cleaned).
if [ ! -f public/engine/manifest.json ]; then
  echo "→ Copying Stockfish engine assets…"
  node tools/copy-engine.mjs
fi

# Restart cleanly: stop anything already listening on the port.
if command -v fuser >/dev/null 2>&1; then
  fuser -k "${PORT}/tcp" 2>/dev/null || true
elif command -v lsof >/dev/null 2>&1; then
  lsof -ti tcp:"$PORT" 2>/dev/null | xargs -r kill 2>/dev/null || true
fi

echo "→ Chess Plus starting at http://localhost:${PORT}"
exec npm run dev -- --port "$PORT" --strictPort --host
