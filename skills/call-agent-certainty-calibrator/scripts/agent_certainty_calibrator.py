#!/usr/bin/env python3
"""call-agent-certainty-calibrator - audit agent assertion language against goal facts.

Twin-mode heuristic skill:
  analyze  flag OVER-ASSERTION (agent states specific values that are in
           neither the goal facts nor any callee turn) and OVER-HEDGING
           (goal facts spoken with hedge words and no source marker), and
           count CALIBRATED statements
  craft    emit a three-tier calibrated-wording goal template for plan_call

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
    "Heuristic text-only analysis of value statements. An OVER-ASSERTED "
    "value may be true and merely missing from the goal text; an "
    "OVER-HEDGED fact may still have been understood. Findings route to "
    "verification against the record, never to assumptions about the "
    "agent's knowledge."
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


def load_goal_file(path: Path) -> str:
    """Load the goal text (plain text, or a JSON with a goal field)."""
    text = path.read_text(encoding="utf-8")
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return text.strip()
    if isinstance(data, dict):
        for key in ("goal", "task", "objective"):
            value = data.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    raise ValueError("goal file must be plain text or a JSON object with a goal field")


# Value lexicons, shared between goal parsing and agent-turn scanning.
_WEEKDAY_RE = re.compile(r"\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b", re.IGNORECASE)
_ORDINAL_RE = re.compile(r"\bthe ([0-9]{1,2})(?:st|nd|rd|th)\b", re.IGNORECASE)
_AMOUNT_RE = re.compile(r"[$]([0-9][0-9 ,./-]*[0-9]|[0-9])\b|\b([0-9][0-9 ,./-]*[0-9]|[0-9])\s+(?:dollars|usd)\b", re.IGNORECASE)
_TIME_RE = re.compile(r"\b(?:at\s+)?([0-9]{1,2})(?::([0-9]{2}))?\s*(a\.?m\.?|p\.?m\.?)\b", re.IGNORECASE)

# Split on sentence enders, but not inside "a.m."/"p.m." (abbreviation
# periods are followed by a lowercase word or comma, real sentence ends by
# a capitalized word).
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z])")

# Hedges weaken a statement that should carry record authority. Bare
# "about" is deliberately excluded: "calling about your delivery" is the
# canonical opening, not a hedge.
_HEDGE_RE = re.compile(
    r"\b(?:i think|i believe|might be|maybe|perhaps|probably|around|"
    r"approximately|roughly|not sure|not certain|i guess|sort of)\b",
    re.IGNORECASE,
)
# Source attribution authorizes plain assertion.
_SOURCE_RE = re.compile(
    r"\b(?:our records?|the record|on file|according to|per (?:your|our)|"
    r"the system shows|your account shows|your invoice shows|as stated in)\b",
    re.IGNORECASE,
)


def _norm_digits(text: str) -> str:
    return re.sub(r"[^0-9]", "", text)


def extract_values(text: str) -> list[tuple[str, str]]:
    """Extract normalized (kind, value) pairs from a text."""
    values: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for m in _WEEKDAY_RE.finditer(text):
        pair = ("date", m.group(1).lower())
        if pair not in seen:
            seen.add(pair)
            values.append(pair)
    for m in _ORDINAL_RE.finditer(text):
        v = _norm_digits(m.group(1))
        if v:
            pair = ("date", v)
            if pair not in seen:
                seen.add(pair)
                values.append(pair)
    for m in _AMOUNT_RE.finditer(text):
        v = _norm_digits(m.group(1) or m.group(2))
        if v:
            pair = ("amount", v)
            if pair not in seen:
                seen.add(pair)
                values.append(pair)
    for m in _TIME_RE.finditer(text):
        hour = m.group(1)
        minute = m.group(2) or "00"
        meridiem = "pm" if "p" in m.group(3).lower() else "am"
        h = int(hour)
        if meridiem == "pm" and h != 12:
            h += 12
        if meridiem == "am" and h == 12:
            h = 0
        pair = ("time", f"{h:02d}{minute}")
        if pair not in seen:
            seen.add(pair)
            values.append(pair)
    return values


CALIBRATED_GOAL = (
    "You are calling with a written record of the facts. Speak every "
    "amount, date, and time from the record plainly and attribute it: "
    "'our record shows the fee is $45'. When you are confident because "
    "the record says so, say so - do not soften record facts with 'I "
    "think' or 'maybe'. When you do NOT have a fact in your record, say "
    "exactly that: 'I do not have that information, but a colleague can "
    "call you back with it.' Never invent a specific value, date, "
    "discount, or deadline to sound helpful - an invented specific is "
    "worse than an honest gap. If you must estimate, label it as an "
    "estimate: 'I believe it is around five days, but I will confirm.'"
)

CRAFT_SCENARIOS = {"calibrated-fact-stating"}


def craft_goal(scenario: str, language: str | None = None) -> dict[str, Any]:
    """Emit plan_call inputs for a calibrated outbound call."""
    if scenario not in CRAFT_SCENARIOS:
        raise ValueError(f"unknown scenario: {scenario!r}; expected one of {sorted(CRAFT_SCENARIOS)}")
    return {
        "skill": "call-agent-certainty-calibrator",
        "mode": "craft",
        "scenario": scenario,
        "language": language or "en",
        "goal": CALIBRATED_GOAL,
        "notes": [
            "Heuristic skill: this template is a starting point; adapt wording to the case.",
            "Keep fictional fixtures offline; any host-run live call requires separate explicit intent and an authorized E.164 destination.",
        ],
    }


def analyze_with_goal(turns: list[dict[str, str]], goal_text: str | None) -> dict[str, Any]:
    """Build the certainty calibration card from turns and goal facts."""
    card: dict[str, Any] = {
        "skill": "call-agent-certainty-calibrator",
        "analysis_mode": "heuristic",
        "calibration_assessment": "assessed",
        "reason": None,
        "goal_facts": {"amount": [], "date": [], "time": []},
        "over_assertions": [],
        "over_hedges": [],
        "calibrated_statements": 0,
        "verdict": "CALIBRATED",
        "recommended_action": {"action": "continue", "guidance": None},
        "disclaimer": DISCLAIMER,
    }

    goal_pairs = extract_values(goal_text) if goal_text else []
    goal_fact_kinds: dict[str, list[str]] = {"amount": [], "date": [], "time": []}
    for kind, value in goal_pairs:
        goal_fact_kinds[kind].append(value)
    card["goal_facts"] = {k: [mask_pii(v) for v in vs] for k, vs in goal_fact_kinds.items()}

    if not turns:
        card["calibration_assessment"] = "unclear"
        card["reason"] = "empty_transcript"
        return card
    agent_turns = [
        (i, str(t.get("text", "")).strip())
        for i, t in enumerate(turns)
        if str(t.get("speaker", "")).lower().strip() not in CALLEE_ROLES and str(t.get("text", "")).strip()
    ]
    if not agent_turns:
        card["calibration_assessment"] = "unclear"
        card["reason"] = "insufficient_agent_signal"
        return card
    if not goal_pairs:
        card["calibration_assessment"] = "unclear"
        card["reason"] = "no_goal_facts_extracted"
        card["recommended_action"] = {
            "action": "review_goal_file",
            "guidance": "The goal text contains no amounts, dates, or times, so agent statements cannot be graded against it.",
        }
        return card

    callee_values: set[tuple[str, str]] = set()
    for t in turns:
        if str(t.get("speaker", "")).lower().strip() in CALLEE_ROLES:
            callee_values.update(extract_values(str(t.get("text", ""))))
    goal_value_set = set(goal_pairs)

    over_assertions: list[dict[str, Any]] = []
    over_hedges: list[dict[str, Any]] = []
    calibrated = 0
    for index, text in agent_turns:
        for sentence in _SENTENCE_SPLIT_RE.split(text):
            sentence = sentence.strip()
            if not sentence:
                continue
            values = extract_values(sentence)
            if not values:
                continue
            sourced = bool(_SOURCE_RE.search(sentence))
            hedged = bool(_HEDGE_RE.search(sentence))
            for kind, value in values:
                if (kind, value) in goal_value_set:
                    if sourced or not hedged:
                        calibrated += 1
                    else:
                        over_hedges.append(
                            {
                                "turn_index": index,
                                "kind": kind,
                                "value": mask_pii(value),
                                "sentence": mask_pii(sentence)[:160],
                            }
                        )
                elif (kind, value) not in callee_values:
                    over_assertions.append(
                        {
                            "turn_index": index,
                            "kind": kind,
                            "value": mask_pii(value),
                            "sentence": mask_pii(sentence)[:160],
                        }
                    )

    card["over_assertions"] = over_assertions
    card["over_hedges"] = over_hedges
    card["calibrated_statements"] = calibrated

    has_over = bool(over_assertions)
    has_hedge = bool(over_hedges)
    if has_over and has_hedge:
        card["verdict"] = "MIXED"
    elif has_over:
        card["verdict"] = "OVERASSERTIVE"
    elif has_hedge:
        card["verdict"] = "OVERHEDGED"

    if has_over or has_hedge:
        card["recommended_action"] = {
            "action": "verify_unsourced_values",
            "guidance": (
                "Agent statements did not match the goal facts. Over-asserted values may be "
                "invented specifics missing from the goal (verify before reuse); hedged record "
                "facts should be restated with their source. Compare with the record, not with "
                "the transcript alone."
            ),
        }
    else:
        card["recommended_action"] = {
            "action": "continue",
            "guidance": "Agent-stated values matched goal facts, plainly or with source attribution.",
        }
    return card


def analyze_turns(turns: list[dict[str, str]]) -> dict[str, Any]:
    """Analyze without a goal file: assessment is unclear by design."""
    return analyze_with_goal(turns, None)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    p_analyze = sub.add_parser("analyze", help="Audit agent certainty language in a finished CALL-E call result.")
    p_analyze.add_argument("--transcript", required=True, help="Path to a CALL-E call result JSON file.")
    p_analyze.add_argument("--goal-file", required=True, help="Path to the goal text (or plan JSON) the call was built from.")
    p_analyze.add_argument("--out", default=None, help="Write the card to this path (default: stdout).")

    p_craft = sub.add_parser("craft", help="Emit a calibrated-wording goal for the next plan_call.")
    p_craft.add_argument("--scenario", required=True, help=f"One of {sorted(CRAFT_SCENARIOS)}.")
    p_craft.add_argument("--language", default=None, help="BCP-47 tag passed through to plan_call (default: en).")
    p_craft.add_argument("--out", default=None, help="Write the plan to this path (default: stdout).")

    args = parser.parse_args(argv)

    if args.command == "analyze":
        path = Path(args.transcript)
        if not path.is_file():
            print(f"ERROR: transcript file not found: {path}", file=sys.stderr)
            return 2
        goal_path = Path(args.goal_file)
        if not goal_path.is_file():
            print(f"ERROR: goal file not found: {goal_path}", file=sys.stderr)
            return 2
        try:
            goal_text = load_goal_file(goal_path)
        except ValueError as exc:
            print(f"ERROR: {exc}", file=sys.stderr)
            return 2
        except OSError as exc:
            print(f"ERROR: cannot read goal file: {exc}", file=sys.stderr)
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
        payload = analyze_with_goal(data["turns"], goal_text)
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
