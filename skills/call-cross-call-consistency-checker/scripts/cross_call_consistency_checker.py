#!/usr/bin/env python3
"""call-cross-call-consistency-checker - compare facts stated across two CALL-E calls.

Twin-mode heuristic skill:
  analyze  extract amounts, dates, and times from the AGENT turns of two
           finished call results for the same destination and grade them
           CONSISTENT / CONTRADICTED / ONLY_STATED per fact kind
  craft    emit a consistency-guarded goal template for the next plan_call

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
    "Heuristic text-only comparison of agent-stated values. A CONTRADICTED "
    "kind may reflect a legitimately changed record - a rescheduled "
    "delivery, an updated price. Every contradiction routes to verification "
    "against the record, never to blame."
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


# Fact extraction from AGENT turns only: the organization's statements are
# what must stay consistent; callee values are corrections, not record.
_WEEKDAY_RE = re.compile(r"\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b", re.IGNORECASE)
_ORDINAL_RE = re.compile(r"\bthe ([0-9]{1,2})(?:st|nd|rd|th)\b", re.IGNORECASE)
_AMOUNT_RE = re.compile(r"[$]([0-9][0-9 ,./-]*[0-9]|[0-9])\b|\b([0-9][0-9 ,./-]*[0-9]|[0-9])\s+(?:dollars|usd)\b", re.IGNORECASE)
_TIME_RE = re.compile(r"\bat ([0-9]{1,2})(?::([0-9]{2}))?\s*(a\.?m\.?|p\.?m\.?)", re.IGNORECASE)


def _norm_digits(text: str) -> str:
    return re.sub(r"[^0-9]", "", text)


def extract_agent_facts(turns: list[dict[str, str]]) -> dict[str, list[str]]:
    """Extract normalized amount/date/time values from agent turns."""
    agent_text = " ".join(
        str(t.get("text", "")).strip()
        for t in turns
        if str(t.get("speaker", "")).lower().strip() not in CALLEE_ROLES
        and str(t.get("text", "")).strip()
    )
    facts: dict[str, list[str]] = {"amount": [], "date": [], "time": []}
    for m in _WEEKDAY_RE.finditer(agent_text):
        v = m.group(1).lower()
        if v not in facts["date"]:
            facts["date"].append(v)
    for m in _ORDINAL_RE.finditer(agent_text):
        v = _norm_digits(m.group(1))
        if v and v not in facts["date"]:
            facts["date"].append(v)
    for m in _AMOUNT_RE.finditer(agent_text):
        v = _norm_digits(m.group(1) or m.group(2))
        if v and v not in facts["amount"]:
            facts["amount"].append(v)
    for m in _TIME_RE.finditer(agent_text):
        hour = m.group(1)
        minute = m.group(2) or "00"
        meridiem = "pm" if "p" in m.group(3).lower() else "am"
        h = int(hour)
        if meridiem == "pm" and h != 12:
            h += 12
        if meridiem == "am" and h == 12:
            h = 0
        v = f"{h:02d}{minute}"
        if v not in facts["time"]:
            facts["time"].append(v)
    return facts


def _has_agent_turns(turns: list[dict[str, str]]) -> bool:
    return any(
        str(t.get("speaker", "")).lower().strip() not in CALLEE_ROLES
        and str(t.get("text", "")).strip()
        for t in turns
    )


CONSISTENCY_GOAL = (
    "You are calling a person your organization has called before. You "
    "have records of what was said on previous calls. State amounts, "
    "dates, and times only as they appear in your record, and say where "
    "they come from: 'our record shows your delivery on Tuesday the "
    "15th'. If the person mentions a different value than you just said, "
    "do not adopt theirs silently and do not insist on yours - say that "
    "the two differ, promise to check, and offer a callback with the "
    "verified answer. Never end a call with two unreconciled values and "
    "no acknowledgment of the difference."
)

CRAFT_SCENARIOS = {"consistency-guarded-callback"}


def craft_goal(scenario: str, language: str | None = None) -> dict[str, Any]:
    """Emit plan_call inputs for a consistency-guarded follow-up call."""
    if scenario not in CRAFT_SCENARIOS:
        raise ValueError(f"unknown scenario: {scenario!r}; expected one of {sorted(CRAFT_SCENARIOS)}")
    return {
        "skill": "call-cross-call-consistency-checker",
        "mode": "craft",
        "scenario": scenario,
        "language": language or "en",
        "goal": CONSISTENCY_GOAL,
        "notes": [
            "Heuristic skill: this template is a starting point; adapt wording to the case.",
            "Keep fictional fixtures offline; any host-run live call requires separate explicit intent and an authorized E.164 destination.",
        ],
    }


def analyze_pair(turns_a: list[dict[str, str]], turns_b: list[dict[str, str]]) -> dict[str, Any]:
    """Build the cross-call consistency card from two normalized turn lists."""
    card: dict[str, Any] = {
        "skill": "call-cross-call-consistency-checker",
        "analysis_mode": "heuristic",
        "consistency_assessment": "assessed",
        "reason": None,
        "comparisons": [],
        "contradiction_count": 0,
        "verdict": "NOTHING_TO_COMPARE",
        "recommended_action": {"action": "continue", "guidance": None},
        "disclaimer": DISCLAIMER,
    }

    if not turns_a or not turns_b:
        card["consistency_assessment"] = "unclear"
        card["reason"] = "empty_transcript_a" if not turns_a else "empty_transcript_b"
        return card
    if not _has_agent_turns(turns_a) or not _has_agent_turns(turns_b):
        card["consistency_assessment"] = "unclear"
        card["reason"] = "no_agent_turns"
        return card

    facts_a = extract_agent_facts(turns_a)
    facts_b = extract_agent_facts(turns_b)

    comparisons: list[dict[str, Any]] = []
    contradictions = 0
    shared_kinds = 0
    for kind in ("amount", "date", "time"):
        va, vb = facts_a[kind], facts_b[kind]
        if not va and not vb:
            continue
        entry: dict[str, Any] = {"kind": kind, "values_a": [mask_pii(v) for v in va], "values_b": [mask_pii(v) for v in vb]}
        shared = [v for v in va if v in vb]
        if shared:
            shared_kinds += 1
            entry["status"] = "CONSISTENT"
            entry["shared"] = [mask_pii(v) for v in shared]
        elif va and vb:
            # No overlap. Within-call multiplicity was already tolerated by
            # the shared check; a reschedule ("from the 12th to the 15th")
            # surfaces as shared when either call also names the other value.
            contradictions += 1
            entry["status"] = "CONTRADICTED"
        else:
            entry["status"] = "ONLY_STATED"
        comparisons.append(entry)

    card["comparisons"] = comparisons
    card["contradiction_count"] = contradictions

    if contradictions:
        card["verdict"] = "CONTRADICTIONS_FOUND"
        card["recommended_action"] = {
            "action": "verify_before_next_call",
            "guidance": CONSISTENCY_GOAL,
        }
    elif shared_kinds:
        card["verdict"] = "CONSISTENT"
        card["recommended_action"] = {
            "action": "continue",
            "guidance": "Agent-stated amounts, dates, and times match across the two calls.",
        }
    else:
        card["verdict"] = "NOTHING_TO_COMPARE"
        card["recommended_action"] = {
            "action": "continue",
            "guidance": "No comparable agent-stated values (amounts, dates, times) in both calls.",
        }
    return card


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    p_analyze = sub.add_parser("analyze", help="Compare agent-stated facts across two finished CALL-E call results.")
    p_analyze.add_argument("--transcript-a", required=True, help="Path to the earlier call result JSON.")
    p_analyze.add_argument("--transcript-b", required=True, help="Path to the later call result JSON.")
    p_analyze.add_argument("--out", default=None, help="Write the card to this path (default: stdout).")

    p_craft = sub.add_parser("craft", help="Emit a consistency-guarded goal for the next plan_call.")
    p_craft.add_argument("--scenario", required=True, help=f"One of {sorted(CRAFT_SCENARIOS)}.")
    p_craft.add_argument("--language", default=None, help="BCP-47 tag passed through to plan_call (default: en).")
    p_craft.add_argument("--out", default=None, help="Write the plan to this path (default: stdout).")

    args = parser.parse_args(argv)

    if args.command == "analyze":
        card: dict[str, Any] | None = None
        for label, raw_path in (("a", args.transcript_a), ("b", args.transcript_b)):
            path = Path(raw_path)
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
            if label == "a":
                turns_a = data["turns"]
                call_id_a = data.get("call_id")
            else:
                turns_b = data["turns"]
                call_id_b = data.get("call_id")
        card = analyze_pair(turns_a, turns_b)
        ids = {"call_a": call_id_a, "call_b": call_id_b}
        card = {**ids, **card}
        payload = card
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
