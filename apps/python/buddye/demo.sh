#!/usr/bin/env bash
# BuddyE live demo launcher. Run from apps/python/buddye:  ./demo.sh
#
# Starts the backend with the provider backend/.env selects (mock unless you set otherwise) and the console, then prints the URL to open.
# Both run in the foreground of their own terminal, so nothing reaps them mid-recording.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DB="${HERE}/demo.db"

cleanup() { kill "${BACK_PID:-}" "${VITE_PID:-}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "→ starting backend (live CALL-E)…"
cd "${HERE}/backend"
DATABASE_URL="sqlite:///${DB}" STEP_DELAY_S=0.25 \
  .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8020 > "${HERE}/demo-backend.log" 2>&1 &
BACK_PID=$!

for _ in $(seq 1 30); do
  if curl -fsS -m 2 http://127.0.0.1:8020/api/health >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS -m 5 http://127.0.0.1:8020/api/health | python3 -c "
import sys,json; d=json.load(sys.stdin)
print(f\"  provider={d['provider']}  calls_used={d['calls_recorded']}\")"

echo "→ seeding a clean board…"
HZ=$(curl -fsS -m 15 -X POST http://127.0.0.1:8020/api/demo/reset \
      -H 'Content-Type: application/json' -d '{}' \
      | python3 -c "import sys,json;print(json.load(sys.stdin)['hazard_id'])")

echo "→ starting the console…"
cd "${HERE}/frontend"
# shellcheck disable=SC1090
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" && nvm use 22 >/dev/null 2>&1 || true
BUDDYE_API=http://127.0.0.1:8020 npm exec vite -- --port 5180 --strictPort > "${HERE}/demo-vite.log" 2>&1 &
VITE_PID=$!
for _ in $(seq 1 30); do
  if curl -fsS -m 2 http://127.0.0.1:5180/ >/dev/null 2>&1; then break; fi
  sleep 1
done

echo
echo "  ┌─────────────────────────────────────────────────────────────"
echo "  │  OPEN THIS:  http://localhost:5180/hazards/${HZ}"
echo "  └─────────────────────────────────────────────────────────────"
echo
echo "  Ctrl-C here stops both. Logs: demo-backend.log, demo-vite.log"
wait
