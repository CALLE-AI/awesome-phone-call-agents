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


# Lexicons. Rule A: a strong irony marker is a positive-sounding phrase that
# is routinely used to express the opposite ("oh great", "just perfect").
# Weak markers ("thanks a lot", "best ... ever") are routinely sincere, so
# they only score when the complaint-context contrast rule also fires
# (Rule B). Scores: 2 per counted marker (capped at 4), +1 contrast bonus.
IRONY_MARKERS: list[tuple[str, str]] = [
    ("oh_great", r"\boh,? great\b"),
    ("just_perfect", r"\bjust perfect\b"),
    ("great_just_great", r"\bgreat,? just great\b"),
    ("yeah_right", r"\byeah,? right\b"),
    ("oh_brilliant", r"\boh,? (?:brilliant|fantastic|wonderful)\b"),
    ("sure_why_not", r"\bsure,? why not\b"),
    ("what_a_surprise", r"\bwhat a (?:surprise|treat|joy)\b"),
    ("love_that_when", r"\b(?:i )?love (?:that|it) when\b"),
]

# Routinely sincere markers: count only alongside a complaint-context
# contrast (see score_turn).
WEAK_MARKERS: list[tuple[str, str]] = [
    ("thanks_a_lot", r"\bthanks a lot\b"),
    ("best_ever", r"\bbest\b.{0,20}\bever\b"),
]

_COMPLAINT_RE = re.compile(
    r"\b(cancel{1,2}ed?|refund|late|broken|wasted?|on hold|third time|"
    r"useless|charged?|error|wrong|complaint|waited)\b",
    re.IGNORECASE,
)
_POSITIVE_RE = re.compile(
    r"\b(good|great|thanks|thank you|perfect|wonderful|fantastic|brilliant|appreciate)\b",
    re.IGNORECASE,
)


class TurnScore:
    """Score of one callee turn against the irony rules."""

    def __init__(self, score: int, rules: list[str], context_contrast: bool) -> None:
        self.score = score
        self.rules = rules
        self.context_contrast = context_contrast


def score_turn(turn_text: str, context_before: str) -> TurnScore:
    """Score one callee turn for verbal irony.

    context_before is the concatenated earlier turn text of the call.
    Weak markers only count when the contrast rule fires, so sincere
    gratitude in a neutral conversation stays at zero.
    """
    strong = [name for name, pattern in IRONY_MARKERS if re.search(pattern, turn_text, re.IGNORECASE)]
    weak = [name for name, pattern in WEAK_MARKERS if re.search(pattern, turn_text, re.IGNORECASE)]
    contrast = bool(
        _COMPLAINT_RE.search(context_before)
        and (_POSITIVE_RE.search(turn_text) or bool(weak))
    )
    matched = strong + (weak if contrast else [])
    score = min(2 * len(matched), 4)
    if contrast:
        score += 1
    rules = list(matched)
    if contrast:
        rules.append("context_contrast")
    return TurnScore(score=score, rules=rules, context_contrast=contrast)


# Remaining stubs; later tasks replace each with its real implementation.


DEESCALATION_GOAL = (
    "You are calling back about this person's recent complaint. Open by "
    "acknowledging their frustration in one sentence before anything else. "
    "Speak at most two sentences per turn, then pause for a reply. Before "
    "acting on any positive-sounding statement made during a complaint "
    "discussion (for example 'great', 'fine', 'perfect'), confirm the "
    "literal intent with one short question such as 'Just to confirm - "
    "would you like me to keep the booking?'. If the caller sounds "
    "frustrated, offer to hand them to a human."
)

VERIFY_INTENT_PROMPT = (
    "On the next contact, ask one short confirmation question such as "
    "'Just to confirm - did you mean that literally?' before acting on "
    "positive-sounding statements made in a complaint context."
)


def _confidence_for(score: int) -> str:
    if score >= 3:
        return "high"
    if score == 2:
        return "medium"
    if score == 1:
        return "low"
    return "none"


def analyze_turns(turns: list[dict[str, str]]) -> dict[str, Any]:
    """Build the irony card from normalized turns."""
    card: dict[str, Any] = {
        "skill": "call-verbal-irony-detector",
        "analysis_mode": "heuristic",
        "irony_assessment": "assessed",
        "irony_detected": False,
        "confidence": "none",
        "stated_sentiment": "neutral",
        "inferred_sentiment": "neutral",
        "evidence": [],
        "recommended_action": {"action": "continue", "guidance": None},
        "disclaimer": DISCLAIMER,
    }

    context_parts: list[str] = []
    evidence: list[dict[str, Any]] = []
    best_score = 0
    for index, turn in enumerate(turns):
        speaker = str(turn.get("speaker", "")).lower().strip()
        text = str(turn.get("text", "")).strip()
        if speaker in CALLEE_ROLES and text:
            result = score_turn(text, " ".join(context_parts))
            if result.score > 0:
                evidence.append(
                    {
                        "turn_index": index,
                        "speaker": speaker,
                        "span": mask_pii(text),
                        "rules": result.rules,
                        "score": result.score,
                    }
                )
                best_score = max(best_score, result.score)
        if text:
            context_parts.append(text)

    if not any(
        str(t.get("speaker", "")).lower().strip() in CALLEE_ROLES and str(t.get("text", "")).strip()
        for t in turns
    ):
        card["irony_assessment"] = "unclear"
        card["reason"] = "insufficient_callee_signal"
        return card

    if not evidence:
        return card

    confidence = _confidence_for(best_score)
    card["confidence"] = confidence
    card["irony_detected"] = confidence in {"high", "medium"}
    card["stated_sentiment"] = "positive"
    card["inferred_sentiment"] = "negative"
    card["evidence"] = evidence
    if confidence in {"high", "medium"}:
        card["recommended_action"] = {
            "action": "retry_with_deescalation_goal",
            "guidance": DEESCALATION_GOAL,
        }
    else:
        card["recommended_action"] = {
            "action": "verify_literal_intent_prompt",
            "guidance": VERIFY_INTENT_PROMPT,
        }
    return card


def craft_goal(scenario: str, language: str | None = None) -> dict[str, Any]:  # pragma: no cover
    raise NotImplementedError
