#!/usr/bin/env python3
"""call-right-party-gatekeeper - audit verify-before-disclose ordering.

Twin-mode heuristic skill:
  analyze  audit a finished call result for right-party verification
  craft    emit a verification-first goal template for the next plan_call

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
    "Heuristic text-only analysis. Verification and disclosure signals are "
    "phrased in many ways this lexicon does not cover; treat WRONG_PARTY and "
    "disclosure-ordering findings as reasons for human review, not as proof."
)


# A candidate is a digit run in which every separator (space, dash, dot,
# comma, slash) sits BETWEEN two ASCII digits. That prevents trailing
# separators from being masked and keeps "10:00" or "3rd" untouched because
# their digit runs are shorter than 7. ASCII [0-9] only, never \d.
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


# Added in Task 3 to keep the planned import surface importable; Tasks 5-6
# replace the remaining stubs with their real implementations.


# Signal vocabulary. Detection is deliberately one-sided: verification
# questions and sensitive disclosures are agent-side patterns; identity
# confirmations, wrong-party and third-party indicators are callee-side.
VERIFICATION_QUESTION = "verification_question"
IDENTITY_CONFIRMATION = "identity_confirmation"
WRONG_PARTY_SIGNAL = "wrong_party_signal"
THIRD_PARTY_SIGNAL = "third_party_signal"
SENSITIVE_DISCLOSURE = "sensitive_disclosure"

_VERIFICATION_Q_RE = re.compile(
    r"\b(?:may i (?:speak|talk) (?:to|with)|can i (?:speak|talk) (?:to|with)|"
    r"am i (?:speaking|talking) (?:to|with)|is this (?:mr|mrs|ms|dr|the)\b|"
    r"can you confirm (?:that )?you(?:'re| are)|are you (?:the )?(?:mr|mrs|ms|dr)\b)",
    re.IGNORECASE,
)
# Anchored complete-reply forms first ("Speaking.", "Yes, I am.") so that
# "Speaking of ..." and "Yes, I am interested ..." cannot match; then
# phrase-level forms. Known false negative, accepted: bare first-name
# verification ("Is this Dana?") does not count as a verification question
# because names are not modeled; such calls degrade to UNVERIFIED, which
# fails safe toward human review.
_IDENTITY_CONFIRM_RE = re.compile(
    r"^(?:speaking|yes,? i am)[.!?]*$"
    r"|\b(?:yes,? this is|this is (?:he|she)|yes,? speaking|"
    r"that'?s me|i'?m (?:the one|him|her))\b",
    re.IGNORECASE,
)
_WRONG_PARTY_RE = re.compile(
    r"\b(?:wrong number|you have the wrong|no one by that name|"
    r"(?:he|she|they) (?:is|are) not (?:here|available|home)|"
    r"(?:he|she|they) can'?t come to the phone|take a message|"
    r"not (?:here|available) right now)\b",
    re.IGNORECASE,
)
_THIRD_PARTY_RE = re.compile(
    r"\b(?:who(?:'s| is) (?:this|calling)|can i (?:ask|tell) (?:him|her|them)|"
    r"i'?m (?:his|her|their) (?:wife|husband|son|daughter|mother|father|friend|roommate|neighbor)|"
    r"(?:he|she|they) (?:is|are) (?:busy|at work|asleep|in a meeting)|"
    r"i'?ll (?:get|go get) (?:him|her|them))\b",
    re.IGNORECASE,
)
_SENSITIVE_RE = re.compile(
    r"\b(?:account (?:number|balance)|balance (?:of|is)|invoice|"
    r"prescription|diagnosis|test results?|medical|policy (?:number|details)|"
    r"claim (?:number|details|status)|date of birth|social security|payment of|"
    r"(?:amount|total|charge) of)\b|\$\s?[0-9]",
    re.IGNORECASE,
)


def detect_signals(speaker: str, text: str) -> list[str]:
    """Return the signal types present in one turn, routed by side."""
    is_callee = str(speaker).lower().strip() in CALLEE_ROLES
    signals: list[str] = []
    if not is_callee:
        if _VERIFICATION_Q_RE.search(text):
            signals.append(VERIFICATION_QUESTION)
        if _SENSITIVE_RE.search(text):
            signals.append(SENSITIVE_DISCLOSURE)
    else:
        if _IDENTITY_CONFIRM_RE.search(text):
            signals.append(IDENTITY_CONFIRMATION)
        if _WRONG_PARTY_RE.search(text):
            signals.append(WRONG_PARTY_SIGNAL)
        if _THIRD_PARTY_RE.search(text):
            signals.append(THIRD_PARTY_SIGNAL)
    return signals


def build_gate_card(turns: list[dict[str, str]]) -> dict[str, Any]:  # pragma: no cover
    raise NotImplementedError


def craft_goal(scenario: str, language: str | None = None) -> dict[str, Any]:  # pragma: no cover
    raise NotImplementedError
