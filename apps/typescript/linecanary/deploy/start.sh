#!/bin/sh
# Deployment host recipe: serve the dashboard and act as the recurrence host.
# LineCanary itself never self-schedules — this wrapper is the "cron".
set -u

# First boot on an empty volume: seed the demo history so the dashboard
# and uptime stats aren't blank while the live schedule ramps up.
if [ ! -f baselines/lines.json ] && [ -d deploy/seed-baselines ]; then
  mkdir -p baselines
  cp deploy/seed-baselines/*.json baselines/ 2>/dev/null || true
  echo "Seeded baselines from deploy/seed-baselines."
fi

node --import tsx src/cli.ts serve --config demo.config.json &
SERVER=$!

# Two live sweeps per day; the configured callWindow drops any run that
# lands outside business hours, so the sleep needs no timezone math.
while true; do
  node --import tsx src/cli.ts run --config demo.config.json --live || true
  sleep 43200
done &

wait $SERVER
