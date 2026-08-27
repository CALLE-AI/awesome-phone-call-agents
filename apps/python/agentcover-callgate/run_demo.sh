#!/usr/bin/env bash
# Reproducible offline walkthrough of the AgentCover CALL-E Call Gate.
# Uses the real `calle-ai` SDK with a MockTransport — no network, no real call.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
export SAFETY_PROTOCOL_SRC="${SAFETY_PROTOCOL_SRC:-C:/Users/michael/safety-protocol/src}"
cd "$HERE"
echo ">> running demo (offline, real SDK via MockTransport)"
python -m agentcover_callgate demo
echo ">> gating the sample appointment plan (dry-run = no dispatch)"
python -m agentcover_callgate gate examples/appointment.json --dry-run
echo ">> tests"
python -m unittest tests.test_gate 2>&1 | tail -4
