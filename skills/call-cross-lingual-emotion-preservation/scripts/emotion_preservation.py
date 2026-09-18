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


# Emotion-intensity lexicon (English only; see module docstring). High
# markers are urgency/panic vocabulary; medium markers are worry vocabulary.
# Score: 2 per high marker + 1 per medium; level: high >= 3, medium >= 1.
_HIGH_URGENCY_RE = re.compile(
    r"\b(?:urgent(?:ly)?|immediately|right now|as soon as possible|"
    r"emergency|critical|danger|hurry|please please|can'?t breathe|"
    r"bleeding|terrified|panicking)\b",
    re.IGNORECASE,
)
_MEDIUM_URGENCY_RE = re.compile(
    r"\b(?:worried|concerned|anxious|scared|afraid|pain|important|"
    r"soon|today|quickly|uncomfortable)\b",
    re.IGNORECASE,
)


def intensity_of(text: str) -> dict[str, Any]:
    """Score the emotional intensity of one text block."""
    markers = [m.group(0) for m in _HIGH_URGENCY_RE.finditer(text)]
    medium_markers = [m.group(0) for m in _MEDIUM_URGENCY_RE.finditer(text)]
    score = 2 * len(markers) + len(medium_markers)
    level = "high" if score >= 3 else ("medium" if score >= 1 else "low")
    return {"score": score, "level": level, "markers": markers + medium_markers}


def load_source_context(path: Path) -> str:
    """Load the requester's context: a call-result JSON (callee turns) or plain text."""
    raw = path.read_text(encoding="utf-8")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return raw.strip()
    if not isinstance(data, dict):
        raise ValueError("source context must be a JSON object or plain text")
    payload = data.get("result") if isinstance(data.get("result"), dict) else data
    transcript = payload.get("transcript")
    if isinstance(transcript, list):
        texts = [
            str(item.get("text", ""))
            for item in transcript
            if isinstance(item, dict) and str(item.get("speaker", "")).lower().strip() in CALLEE_ROLES
        ]
        joined = " ".join(t for t in texts if t).strip()
        if joined:
            return joined
        raise ValueError("source context JSON has no transcript")
    if isinstance(transcript, str) and transcript.strip():
        return transcript.strip()
    raise ValueError("source context JSON has no transcript")


def build_parity_card(source_context: str, relay_turns: list[dict[str, str]]) -> dict[str, Any]:  # pragma: no cover
    raise NotImplementedError


def craft_goal(scenario: str, language: str | None = None, intensity: str = "high") -> dict[str, Any]:  # pragma: no cover
    raise NotImplementedError
