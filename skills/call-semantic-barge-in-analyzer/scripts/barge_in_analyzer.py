#!/usr/bin/env python3
"""call-semantic-barge-in-analyzer - profile callee cooperation and pacing.

Twin-mode heuristic skill:
  analyze  classify callee turns into backchannels / barge-ins / substantive
  craft    emit a pacing goal template for the next plan_call

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
    "Heuristic text-only analysis. Backchannels and barge-ins are phrased "
    "in many ways this lexicon does not cover; profiles are pacing advice "
    "for the next call, not judgments about the person."
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


# Turn classification. A callee turn is one of:
#   backchannel  short listening sound after an agent STATEMENT ("Mm-hmm.")
#   barge_in     frustration / hold language anywhere in the turn
#   substantive  everything else, including short answers to agent QUESTIONS
# The question-vs-statement rule: a short vocabulary turn that answers a
# trailing-question agent turn is an ANSWER, not a backchannel. Bare "look"
# is deliberately NOT a barge-in marker ("I will look into that").
BACKCHANNEL = "backchannel"
BARGE_IN = "barge_in"
SUBSTANTIVE = "substantive"

_BARGE_IN_RE = re.compile(
    r"\b(?:wait(?! (?:for|until|till)\b)|hold on|hang on|stop(?! (?:by|at|in)\b)|"
    r"enough|listen,|slow down|too fast|"
    r"one at a time|let me (?:write|say|ask|finish|talk)|you'?re going too)\b",
    re.IGNORECASE,
)
_QUESTION_END_RE = re.compile(r"\?[\"'\u201d\u2019)\s]*$")
_TOKENS_RE = re.compile(r"[a-z'-]+")

# A turn counts as a backchannel only if it is at most 4 words and every
# word is listening vocabulary. "yes"/"sure" are included for the statement
# case; the question rule above keeps them as answers when they answer one.
BACKCHANNEL_WORDS = {
    "mm", "mm-hmm", "mmm", "hmm", "mhm", "uh-huh", "yeah", "yep", "yup",
    "yes", "right", "ok", "okay", "sure", "got", "it", "i", "see", "makes",
    "sense", "sounds", "good", "go", "on", "keep", "going", "please",
    "continue", "of", "course", "that", "works",
}


def _is_backchannel_text(text: str) -> bool:
    tokens = _TOKENS_RE.findall(text.lower())
    return 0 < len(tokens) <= 4 and all(token in BACKCHANNEL_WORDS for token in tokens)


def classify_callee_turn(text: str, previous_agent_text: str) -> str:
    """Classify one callee turn given the agent turn immediately before it."""
    if _BARGE_IN_RE.search(text):
        return BARGE_IN
    if _is_backchannel_text(text):
        if _QUESTION_END_RE.search(previous_agent_text or ""):
            return SUBSTANTIVE
        return BACKCHANNEL
    return SUBSTANTIVE


def build_pacing_card(turns: list[dict[str, str]]) -> dict[str, Any]:  # pragma: no cover
    raise NotImplementedError


def craft_goal(scenario: str, language: str | None = None) -> dict[str, Any]:  # pragma: no cover
    raise NotImplementedError
