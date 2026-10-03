#!/usr/bin/env python3
"""call-answer-evasion-auditor - grade agent answers to callee direct questions.

Twin-mode heuristic skill:
  analyze  find CALLEE direct questions (identity, yes-no, information)
           and grade the next two agent turns as CLEAR, PARTIALLY_CLEAR
           or EVASIVE with a dodge mechanism
  craft    emit an answer-first goal template for plan_call

Runs offline, deterministic, no LLM, no network. Input errors exit 2.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

CALLEE_ROLES = {"callee", "customer", "patient", "caller", "recipient"}

DISCLAIMER = (
    "Heuristic text-only grading of agent answers. An EVASIVE grade is "
    "evidence of wording, not of intent to deceive; the agent may lack "
    "the information, which counts as CLEAR only when stated plainly "
    "('I don't have that information'). Findings route to review, never "
    "to auto-invalidation of the call."
)

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
    """Load a CALL-E call result and normalize its transcript to turns."""
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


# Split on sentence enders, but not inside "a.m."/"p.m." (abbreviation
# periods are followed by a lowercase word or comma, real sentence ends by
# a capitalized word).
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])(?<![aApP]\.m\.)\s+(?=[A-Z])")

# Whole-turn repair initiators are delegated to
# call-repair-sequence-auditor; matched on lowercased, whitespace-collapsed
# turn text.
REPAIR_INITIATORS = {
    "sorry?",
    "pardon?",
    "what?",
    "come again?",
    "excuse me?",
    "what was that?",
    "can you repeat that?",
    "say that again?",
    "sorry, what?",
    "sorry, what was that?",
    "one more time?",
}

_WH_START_RE = re.compile(r"^(?:who|what|when|where|why|how|which|whose|whom)\b", re.IGNORECASE)

_IDENTITY_Q_RE = re.compile(r"\b(?:robot|\bai\b|a\.i\.|artificial intelligence|automated|recording|real (?:person|human)|virtual assistant|a machine|an? actual person)\b", re.IGNORECASE)

_AI_SELF_RE = re.compile(r"\b(?:i(?:'m| am) (?:an? )?(?:ai|automated|virtual assistant|artificial intelligence)|(?:an?|the) (?:ai|automated (?:assistant|system|caller)|virtual assistant)|this (?:call|is) (?:is )?(?:an? )?(?:ai|automated|recording)|not a (?:real )?(?:person|human)|ai[- ]powered|(?:yes|no)[,]?\s+(?:i(?:'m| am)|this is) (?:an? )?(?:ai|automated))\b", re.IGNORECASE)

_YES_NO_FIRST_RE = re.compile(r"^(?:yes|yeah|yep|no|nope|correct|that'?s right|that is right|i (?:am|do|did|have|can|will)|i'?m not|i don'?t|i do not|we (?:do|don'?t|did|can|cannot|will|won'?t))\b", re.IGNORECASE)

_YES_NO_ANY_RE = re.compile(r"\b(?:yes|yeah|no|nope|correct|that'?s right|i (?:am|do|did|have|can|will))\b", re.IGNORECASE)

_NOT_KNOWING_RE = re.compile(r"\b(?:i don'?t (?:know|have that)|i do not (?:know|have that)|i'?m not sure|i am not sure)\b", re.IGNORECASE)

_PROVENANCE_RE = re.compile(r"\b(?:(?:got|received|obtained|took) (?:your|the) number (?:from|off|out of)|your (?:reservation|booking|order|account|profile|customer record)|you (?:provided|gave|left) (?:it|your number|your contact)|(?:our|the) (?:customer|guest|patient|waitlist|delivery) list|the (?:event|organizer|clinic|restaurant) (?:list|provided) (?:it|your number)?)\b", re.IGNORECASE)

_NON_ANSWER_ACK_RE = re.compile(r"\b(?:great question|good question|excellent question|fair question|thank you for asking|i understand (?:your|that) (?:concern|question|frustration))\b", re.IGNORECASE)

_DEFER_RE = re.compile(r"\b(?:we'?ll get to that|we will get to that|let'?s come back to that|let us come back to that|as i (?:mentioned|said)|we can (?:discuss|cover) that later)\b", re.IGNORECASE)

_AMOUNT_RE = re.compile(r"\$[0-9]|[0-9]\s+dollars", re.IGNORECASE)


def analyze_turns(turns: list[dict[str, str]]) -> dict[str, Any]:
    """TDD stub: implemented after the core tests are observed failing."""
    raise NotImplementedError("core grading not implemented yet")


def craft_goal(scenario: str, language: str | None = None) -> dict[str, Any]:
    """TDD stub: implemented after the craft tests are observed failing."""
    raise NotImplementedError("craft not implemented yet")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    p_analyze = sub.add_parser("analyze", help="Grade agent answers to callee direct questions in a CALL-E call result.")
    p_analyze.add_argument("--transcript", required=True, help="Path to a CALL-E call result JSON file.")
    p_analyze.add_argument("--out", default=None, help="Write the report to this path (default: stdout).")

    p_craft = sub.add_parser("craft", help="Emit an answer-first goal template for the next plan_call.")
    p_craft.add_argument("--scenario", required=True, help="One of: booking-candid, support-candid.")
    p_craft.add_argument("--language", default=None, help="BCP-47 tag passed through to plan_call (default: en).")
    p_craft.add_argument("--out", default=None, help="Write the plan to this path (default: stdout).")

    args = parser.parse_args(argv)

    if args.command == "analyze":
        path = Path(args.transcript)
        if not path.is_file():
            print(f"ERROR: transcript file not found: {path}", file=sys.stderr)
            return 2
        try:
            data = load_call_result(path)
        except json.JSONDecodeError as exc:
            print(f"ERROR: invalid JSON in transcript file: {exc}", file=sys.stderr)
            return 2
        except ValueError as exc:
            print(f"ERROR: {exc}", file=sys.stderr)
            return 2
        except OSError as exc:
            print(f"ERROR: cannot read transcript file: {exc}", file=sys.stderr)
            return 2
        payload = analyze_turns(data["turns"])
        if data.get("call_id"):
            payload = {"call_id": data["call_id"], **payload}
    else:
        try:
            payload = craft_goal(args.scenario, language=args.language)
        except ValueError as exc:
            print(f"ERROR: {exc}", file=sys.stderr)
            return 2

    output = json.dumps(payload, indent=2, ensure_ascii=False)
    if args.out:
        Path(args.out).write_text(output + "\n", encoding="utf-8")
        print(f"Written to {args.out}", file=sys.stderr)
    else:
        print(output)
    return 0


if __name__ == "__main__":
    sys.exit(main())
