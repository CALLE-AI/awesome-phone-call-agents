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


# A candidate is a digit run in which every separator (space, dash, dot,
# comma, slash) sits BETWEEN two ASCII digits. That prevents trailing
# separators from being masked and keeps "10:00" or "3rd" untouched because
# their digit runs are shorter than 7. ASCII [0-9] only, never \\d.
_DIGIT_RUN_RE = re.compile(r"[0-9](?:[ ,./-][0-9]|[0-9])*")


def _mask_match(m: re.Match[str]) -> str:
    run = m.group(0)
    digit_count = sum(1 for ch in run if ch in "0123456789")
    if digit_count < 7:
        return run
    return "#" * (len(run) - 2) + run[-2:]


def mask_pii(text: str) -> str:
    """Mask any 7+-digit run (separators included) keeping the last 2 chars."""
    return _DIGIT_RUN_RE.sub(_mask_match, text)


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


# Added in Task 3 to keep the planned import surface importable; Tasks 4-6
# replace each stub with its real implementation.

COLORS = ("BLUE", "RED", "GREEN", "ORANGE", "WHITE", "BLACK", "YELLOW", "PURPLE")
NUMBER_WORDS = ("ZERO", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE")

_CONFUSABLES = {
    "FOR": "FOUR",
    "FORE": "FOUR",
    "TO": "TWO",
    "TOO": "TWO",
    "WON": "ONE",
    "ATE": "EIGHT",
    "TREE": "THREE",
}
_DIGIT_WORDS = {str(i): word for i, word in enumerate(NUMBER_WORDS)}


def derive_code(secret: str, nonce: str) -> list[str]:
    """Derive the 4-token spoken code from HMAC-SHA256(secret, nonce)."""
    digest = hmac.new(secret.encode("utf-8"), nonce.encode("utf-8"), hashlib.sha256).digest()
    value = int.from_bytes(digest[:8], "big")
    return [
        COLORS[value % len(COLORS)],
        COLORS[(value // len(COLORS)) % len(COLORS)],
        NUMBER_WORDS[(value // (len(COLORS) * len(COLORS))) % len(NUMBER_WORDS)],
        f"{(value // (len(COLORS) * len(COLORS) * len(NUMBER_WORDS))) % 100:02d}",
    ]


def _normalize_tokens(text: str) -> list[str]:
    """Uppercase alnum tokens; digit strings expand to digit words; confusables fold."""
    tokens: list[str] = []
    for raw in re.findall(r"[A-Z0-9]+", str(text).upper()):
        if raw.isdigit():
            tokens.extend(_DIGIT_WORDS[ch] for ch in raw)
        else:
            tokens.append(_CONFUSABLES.get(raw, raw))
    return tokens


def _levenshtein(a: str, b: str) -> int:
    """Classic dynamic-programming edit distance."""
    if len(a) < len(b):
        a, b = b, a
    previous = list(range(len(b) + 1))
    for i, char_a in enumerate(a, start=1):
        current = [i]
        for j, char_b in enumerate(b, start=1):
            current.append(
                min(
                    previous[j] + 1,
                    current[j - 1] + 1,
                    previous[j - 1] + (char_a != char_b),
                )
            )
        previous = current
    return previous[-1]


def _match_response(expected: list[str], heard: list[str], max_edit: int = 1) -> bool:
    """True when expected appears in heard, in order, each pair within max_edit."""
    i = 0
    for exp in expected:
        while i < len(heard) and _levenshtein(exp, heard[i]) > max_edit:
            i += 1
        if i >= len(heard):
            return False
        i += 1
    return True


def build_attestation_card(turns: list[dict[str, str]], nonce: str, expected_code: str, ledger_path: Path | None = None) -> dict[str, Any]:  # pragma: no cover
    raise NotImplementedError


def craft_goal(scenario: str, language: str | None = None, nonce: str | None = None, secret_env: str = "CALL_ATTEST_SECRET") -> dict[str, Any]:  # pragma: no cover
    raise NotImplementedError
