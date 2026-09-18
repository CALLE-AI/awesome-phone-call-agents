#!/usr/bin/env python3
"""call-attest-challenge-auth - one-time spoken challenge-response for M2M calls.

Twin-mode heuristic skill:
  craft   generate a nonce + HMAC-derived spoken code and the plan_call goal
  verify  check a finished transcript's reply against the expected code,
          with a JSONL nonce ledger for replay detection

Companion to dialtone-handshake: DIALTONE recognizes the other end is AI;
this skill proves one-time pre-shared coordination. The secret comes from
an environment variable, never the command line. Runs offline,
deterministic, no LLM, no network. Input errors exit 2.
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import re
import secrets
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Speaker-role labels that represent the contacted party. Any other label is
# the agent side. Kept identical to call-summarizer for cross-skill
# consistency.
CALLEE_ROLES = {"callee", "customer", "patient", "caller", "recipient"}

DISCLAIMER = (
    "Heuristic spoken-code verification over a phonetic channel. This "
    "proves one-time pre-shared coordination, nothing more; it gives no "
    "resistance to a determined man-in-the-middle. Treat FAILED and "
    "REPLAY findings as reasons to stop and investigate."
)


def load_call_result(path: Path) -> dict[str, Any]:
    """Load a CALL-E call result and normalize its transcript to turns.

    Accepts both the real get_call_run shape ({status, result: {transcript}})
    and the flat fixture shape ({status, transcript}) used by sibling skills.
    A plain-string transcript becomes one agent-labelled turn.
    """
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"call result must be a JSON object, got {type(data).__name__}")
    payload = data.get("result") if isinstance(data.get("result"), dict) else data
    raw = payload.get("transcript", "")
    if isinstance(raw, str):
        turns = [{"speaker": "agent", "text": raw}] if raw.strip() else []
    elif isinstance(raw, list):
        turns = [
            {"speaker": str(item.get("speaker", "unknown")), "text": str(item.get("text", ""))}
            for item in raw
            if isinstance(item, dict)
        ]
    else:
        turns = []
    return {
        "call_id": data.get("call_id") or payload.get("call_id"),
        "status": data.get("status") or payload.get("status"),
        "turns": turns,
    }
