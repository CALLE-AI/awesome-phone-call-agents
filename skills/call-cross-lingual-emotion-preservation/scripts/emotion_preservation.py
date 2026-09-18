#!/usr/bin/env python3
"""call-cross-lingual-emotion-preservation - audit emotion parity in relays.

Twin-mode heuristic skill:
  analyze  compare the requester's emotional intensity against what the
           relayed call actually expressed
  craft    emit an intensity-calibrated relay goal for the next plan_call

Companion to language-bridge-call: this skill audits and calibrates, it
never relays. Runs offline, deterministic, no LLM, no network. Input
errors exit 2.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

# Speaker-role labels that represent the contacted party. Any other label is
# the agent side. Kept identical to call-summarizer for cross-skill
# consistency.
CALLEE_ROLES = {"callee", "customer", "patient", "caller", "recipient"}

DISCLAIMER = (
    "Heuristic text-only analysis with an English-only intensity lexicon. "
    "Emotional intensity phrasing varies widely; drift findings are a "
    "reason to re-check the relay wording, not proof of harm."
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
    # Normalize status casing so flat fixtures ("completed") and real
    # get_call_run payloads ("COMPLETED") compare consistently.
    status = data.get("status") or payload.get("status")
    return {
        "call_id": data.get("call_id") or payload.get("call_id"),
        "status": status,
        "turns": turns,
    }


# Added in Task 3 to keep the planned import surface importable; Tasks 4-6
# replace each stub with its real implementation.


def intensity_of(text: str) -> dict[str, Any]:  # pragma: no cover
    raise NotImplementedError


def load_source_context(path: Path) -> str:  # pragma: no cover
    raise NotImplementedError


def build_parity_card(source_context: str, relay_turns: list[dict[str, str]]) -> dict[str, Any]:  # pragma: no cover
    raise NotImplementedError


def craft_goal(scenario: str, language: str | None = None, intensity: str = "high") -> dict[str, Any]:  # pragma: no cover
    raise NotImplementedError
