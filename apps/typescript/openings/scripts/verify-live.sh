#!/usr/bin/env bash
set -uo pipefail

# Live verification runner: produces a real Philadelphia access report.
#
#   pnpm verify:live
#
# Prerequisites:
#   - CALLE_API_KEY in the environment or .env
#   - enough CALL-E credits (each candidate = 1 call; default sample 5)
#   - business hours in the target city for positive signals
#
# Steps:
#   1. Offline check: typecheck + lint + default tests
#   2. Live pipeline: frame -> wave dispatch -> classify -> persist (real calls)
#   3. Print the watch id + DB path so you can open the app and view the report
#
# Tuning (env vars):
#   OPENINGS_SAMPLE_SIZE  sample of candidates (default 5)
#   OPENINGS_DB_PATH      where results persist (default /tmp/openings-live.db)
#   OPENINGS_LOCATION     e.g. "Philadelphia, PA"
#   OPENINGS_PLAN         e.g. "Aetna PPO"
#   OPENINGS_NEED         e.g. "adult ADHD evaluation"
cd "$(dirname "$0")/.."

if [[ -f .env ]]; then
  set -a; source .env; set +a
fi

if [[ -z "${CALLE_API_KEY:-}" ]]; then
  echo "!! CALLE_API_KEY is not set. Add it to .env or export it." >&2
  exit 1
fi

echo "==> 1/3 Offline checks"
pnpm check || exit 1

echo "==> 2/3 Live pipeline (places real calls, spends credits)"
export OPENINGS_LIVE_TESTS=1
# Override the store path unconditionally: a stale value from .env (e.g.
# /data/openings.db for Fly) does not exist on a dev machine.
export OPENINGS_DB_PATH="/tmp/openings-live.db"
rm -f "$OPENINGS_DB_PATH"
pnpm vitest run tests/live-app.test.ts || exit 1

echo "==> 3/3 Done."
echo "    View the report:"
echo "      OPENINGS_CALL_MODE=live OPENINGS_STORE=sqlite OPENINGS_DB_PATH=$OPENINGS_DB_PATH pnpm dev"
echo "      then open /watch/<watch-id> and /reports"
