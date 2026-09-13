#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "[1/4] Validate a consented plan"
python3 -m consent_gate validate examples/consented_test_call.json

echo
echo "[2/4] Produce a redacted approval manifest"
python3 -m consent_gate manifest examples/consented_test_call.json

echo
echo "[3/4] Run the deterministic offline call simulation"
python3 -m consent_gate simulate examples/consented_test_call.json

echo
echo "[4/4] Run the policy test suite"
python3 -m unittest discover -s tests -v

