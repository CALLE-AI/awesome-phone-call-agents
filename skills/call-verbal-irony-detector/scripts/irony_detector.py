#!/usr/bin/env python3
"""call-verbal-irony-detector - detect verbal irony in CALL-E transcripts.

Twin-mode heuristic skill:
  analyze  score a finished call result for stated-vs-meant sentiment mismatch
  craft    emit a de-escalation goal template for the next plan_call

Runs offline, deterministic, no LLM, no network. Input errors exit 2.
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
    "Heuristic text-only analysis. Verbal irony signals in text are "
    "ambiguous; treat HIGH/MEDIUM results as a reason to re-verify intent, "
    "not as a certainty."
)


def load_call_result(path: Path) -> dict[str, Any]:
    """Load a CALL-E call result and normalize its transcript to turns.

    Accepts both the real get_call_run shape ({status, result: {transcript}})
    and the flat fixture shape ({status, transcript}) used by sibling skills.
    A plain-string transcript becomes one agent-labelled turn.
    """
    data = json.loads(path.read_text(encoding="utf-8"))
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


# Added in Task 2 to keep the planned import surface importable; Tasks 3-6
# replace each stub with its real implementation.


def mask_pii(text: str) -> str:  # pragma: no cover - replaced in Task 3
    raise NotImplementedError


def score_turn(turn_text: str, context_before: str) -> Any:  # pragma: no cover
    raise NotImplementedError


def analyze_turns(turns: list[dict[str, str]]) -> dict[str, Any]:  # pragma: no cover
    raise NotImplementedError


def craft_goal(scenario: str, language: str | None = None) -> dict[str, Any]:  # pragma: no cover
    raise NotImplementedError
