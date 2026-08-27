#!/usr/bin/env bash
# One command to get a coordinator from "downloaded this" to "using it":
#   ./run.sh
# Creates the environment on first run, reuses it after, opens the browser.
# No manual venv activation, no pip install, no remembering flags.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required. Install it from python.org, then run ./run.sh again." >&2
  exit 1
fi

if [ ! -d .venv ]; then
  echo "First run -- setting up (this takes under a minute)..."
  python3 -m venv .venv
fi

# shellcheck disable=SC1091
source .venv/bin/activate

# Only reinstall if the environment looks stale (pyproject.toml changed
# since we last installed), so repeat launches are instant.
STAMP=.venv/.mobilize_install_stamp
if [ ! -f "$STAMP" ] || [ pyproject.toml -nt "$STAMP" ]; then
  pip install --quiet -e ".[dev]"
  touch "$STAMP"
fi

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

PORT="${MOBILIZE_DASHBOARD_PORT:-8731}"
URL="http://localhost:${PORT}"

echo ""
echo "mobilize is starting at ${URL}"
echo "Press Ctrl+C to stop."
echo ""

(
  # Wait for the server to actually be ready before opening the browser,
  # rather than guessing with a fixed sleep.
  for _ in $(seq 1 50); do
    if curl -s -o /dev/null "$URL" 2>/dev/null; then
      if command -v open >/dev/null 2>&1; then open "$URL"       # macOS
      elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"  # Linux
      fi
      break
    fi
    sleep 0.2
  done
) &

python3 -m mobilize.app.dashboard
