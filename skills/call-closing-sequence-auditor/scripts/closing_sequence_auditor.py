#!/usr/bin/env python3
"""call-closing-sequence-auditor - audit the closing window of a CALL-E call.

Twin-mode heuristic skill:
  analyze  audit the final turns for conversation-analytic closing shape:
           pre-closing summary, arrangement for next steps, completed
           terminal exchange, dangling callee questions, business after
           the farewell, abrupt ends
  craft    emit a clean-closing goal template for plan_call

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
    "Sequence-shape heuristics, not a satisfaction measure. A call may "
    "legitimately end without a summary - the person can hang up "
    "mid-flow. DEFICIENT means review the ending, not that the call "
    "failed. English-only patterns."
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


# Value lexicons, shared with the calibrator family: a "value hit" means a
# concrete date, ordinal, amount, or clock time appears in the text.
_WEEKDAY_RE = re.compile(r"\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b", re.IGNORECASE)
_ORDINAL_RE = re.compile(r"\bthe ([0-9]{1,2})(?:st|nd|rd|th)\b", re.IGNORECASE)
_AMOUNT_RE = re.compile(r"[$]([0-9][0-9 ,./-]*[0-9]|[0-9])\b|\b([0-9][0-9 ,./-]*[0-9]|[0-9])\s+(?:dollars|usd)\b", re.IGNORECASE)
_TIME_RE = re.compile(r"\b(?:at\s+)?([0-9]{1,2})(?::([0-9]{2}))?\s*(a\.?m\.?|p\.?m\.?)\b", re.IGNORECASE)

# Split on sentence enders, but not inside "a.m."/"p.m." (abbreviation
# periods excluded via fixed-width lookbehind).
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])(?<![aApP]\.m\.)\s+(?=[A-Z])")

# Closing-window lexicons (case-insensitive).
SUMMARY_MARKERS = re.compile(r"\b(?:to summarize|just to confirm|to recap|recap|summarizing|so to confirm)\b", re.IGNORECASE)
CONFIRM_VERBS = re.compile(r"\b(?:booked|confirmed|cancelled|canceled|rescheduled|reserved)\b", re.IGNORECASE)
ARRANGEMENT_RE = re.compile(
    r"(?:(?:we'?ll|we will) (?:send|email|call|text|mail)|"
    r"(?:you'?ll|you will) (?:receive|get)|"
    r"(?:i'?ll|i will) (?:call|send|email|text) (?:you|the|it|a)|"
    r"no further action|nothing else (?:needed|required))",
    re.IGNORECASE,
)
FAREWELL_RE = re.compile(
    r"(?:goodbye|good bye|have a (?:great|good|wonderful|nice) (?:day|evening|week)|"
    r"take care|talk soon|\bbye\b)",
    re.IGNORECASE,
)

WINDOW_SIZE = 6

READABLE_REASONS = {
    "MISSING_SUMMARY": "Missing summary",
    "MISSING_ARRANGEMENT": "Missing arrangement",
    "NO_TERMINAL_EXCHANGE": "No terminal exchange",
    "DANGLING_QUESTION": "Dangling question",
    "POST_CLOSING_BUSINESS": "Post closing business",
    "ABRUPT_END": "Abrupt end",
}

CLEAN_CLOSING_GOAL = (
    "Close every call cleanly. Restate the outcome with its key value: "
    "'Just to confirm - table for four on Friday the 15th at 7 p.m.' "
    "State the next step: 'You'll receive a confirmation text shortly.' "
    "Ask 'Is there anything else I can help you with?' and WAIT for the "
    "answer. Only after the person has nothing further, say goodbye and "
    "end the call. Never introduce new business - dates, numbers, "
    "requests - after the goodbye."
)

CRAFT_SCENARIOS = {"clean-closing"}


def _has_value(text: str) -> bool:
    """True if the text contains any concrete date, ordinal, amount, or time."""
    return bool(
        _WEEKDAY_RE.search(text)
        or _ORDINAL_RE.search(text)
        or _AMOUNT_RE.search(text)
        or _TIME_RE.search(text)
    )


def _is_callee(speaker: str) -> bool:
    return speaker.lower().strip() in CALLEE_ROLES


def _farewell_only(text: str) -> bool:
    """True if removing every farewell sentence leaves nothing."""
    sentences = [s.strip() for s in _SENTENCE_SPLIT_RE.split(text)]
    remainder = " ".join(s for s in sentences if s and not FAREWELL_RE.search(s))
    return remainder.strip() == ""


def closing_checks(turns: list[dict[str, str]]) -> dict[str, bool]:
    """Compute the six closing-window booleans for a turn list."""
    checks = {
        "summary_present": False,
        "arrangement_present": False,
        "terminal_exchange_complete": False,
        "dangling_question": False,
        "post_closing_business": False,
        "abrupt_end": False,
    }
    window_start = max(0, len(turns) - WINDOW_SIZE)
    agent_turns: list[tuple[int, str]] = []
    callee_turns: list[tuple[int, str]] = []
    for i, t in enumerate(turns):
        speaker = str(t.get("speaker", ""))
        text = str(t.get("text", "")).strip()
        if not text:
            continue
        if _is_callee(speaker):
            callee_turns.append((i, text))
        else:
            agent_turns.append((i, text))
    agent_in_window = [(i, tx) for i, tx in agent_turns if i >= window_start]

    # 1. Pre-closing summary: a summary marker, or a confirm verb backed
    # by a concrete value, spoken by the agent inside the window.
    checks["summary_present"] = any(
        SUMMARY_MARKERS.search(tx) or (CONFIRM_VERBS.search(tx) and _has_value(tx))
        for _, tx in agent_in_window
    )
    # 2. Arrangement: an agent move that settles what happens next.
    checks["arrangement_present"] = any(ARRANGEMENT_RE.search(tx) for _, tx in agent_in_window)
    # 3. Terminal exchange: both sides produced a farewell, the callee's
    # anywhere after the very first turn.
    checks["terminal_exchange_complete"] = any(
        FAREWELL_RE.search(tx) for _, tx in agent_in_window
    ) and any(i >= 1 and FAREWELL_RE.search(tx) for i, tx in callee_turns)
    # 4. Dangling question: the callee's last "?" never received a
    # substantive agent reply - only farewells, or nothing at all.
    question_indices = [i for i, tx in callee_turns if "?" in tx]
    if question_indices:
        last_question = question_indices[-1]
        replies = [(i, tx) for i, tx in agent_turns if i > last_question]
        checks["dangling_question"] = (not replies) or all(_farewell_only(tx) for _, tx in replies)
    # 5. Post-closing business: the agent volunteering values or questions
    # after its own first farewell.
    farewell_positions = [i for i, tx in agent_turns if FAREWELL_RE.search(tx)]
    if farewell_positions:
        first_farewell = farewell_positions[0]
        checks["post_closing_business"] = any(
            _has_value(tx) or "?" in tx for i, tx in agent_turns if i > first_farewell
        )
    # 6. Abrupt end: no agent farewell in the window, and the call stops
    # on a question or on a plain non-farewell turn.
    if not any(FAREWELL_RE.search(tx) for _, tx in agent_in_window):
        last_agent_text = agent_turns[-1][1] if agent_turns else ""
        # Read the last NON-EMPTY turn, matching the filtering used for the
        # agent/callee turn lists - a whitespace-only tail is not speech.
        nonempty_texts = [str(t.get("text", "")).strip() for t in turns if str(t.get("text", "")).strip()]
        last_turn_text = nonempty_texts[-1] if nonempty_texts else ""
        last_agent_asks = last_agent_text.endswith("?")
        last_turn_settled = bool(FAREWELL_RE.search(last_turn_text)) or last_turn_text.endswith("?")
        checks["abrupt_end"] = last_agent_asks or not last_turn_settled
    return checks


def _verdict_and_reasons(checks: dict[str, bool]) -> tuple[str | None, list[str]]:
    reasons: list[str] = []
    if not checks["summary_present"]:
        reasons.append("MISSING_SUMMARY")
    if not checks["arrangement_present"]:
        reasons.append("MISSING_ARRANGEMENT")
    # The abrupt-end reason already covers a missing goodbye; naming both
    # would double-count one truncated ending.
    if not checks["terminal_exchange_complete"] and not checks["abrupt_end"]:
        reasons.append("NO_TERMINAL_EXCHANGE")
    if checks["dangling_question"]:
        reasons.append("DANGLING_QUESTION")
    if checks["post_closing_business"]:
        reasons.append("POST_CLOSING_BUSINESS")
    if checks["abrupt_end"]:
        reasons.append("ABRUPT_END")
    return ("WELL_FORMED_CLOSING" if not reasons else "DEFICIENT_CLOSING"), reasons


def _empty_checks() -> dict[str, bool]:
    return {key: False for key in (
        "summary_present",
        "arrangement_present",
        "terminal_exchange_complete",
        "dangling_question",
        "post_closing_business",
        "abrupt_end",
    )}


def analyze_turns(turns: list[dict[str, str]]) -> dict[str, Any]:
    """Build the closing-sequence card from normalized turns."""
    card: dict[str, Any] = {
        "skill": "call-closing-sequence-auditor",
        "analysis_mode": "heuristic",
        "closing_assessment": "assessed",
        "reason": None,
        "checks": _empty_checks(),
        "verdict": None,
        "reasons": [],
        "recommended_action": {"action": "continue", "guidance": None},
        "disclaimer": DISCLAIMER,
    }

    if not turns:
        card["closing_assessment"] = "unclear"
        card["reason"] = "empty_transcript"
        return card
    if len(turns) < 2:
        card["closing_assessment"] = "unclear"
        card["reason"] = "insufficient_signal"
        return card

    checks = closing_checks(turns)
    verdict, reasons = _verdict_and_reasons(checks)
    card["checks"] = checks
    card["verdict"] = verdict
    card["reasons"] = reasons
    if verdict == "DEFICIENT_CLOSING":
        readable = ", ".join(READABLE_REASONS[r] for r in reasons)
        card["recommended_action"] = {
            "action": "review_call_ending",
            "guidance": (
                f"The closing window is incomplete: {readable}. "
                "Decide whether the ending needs a follow-up touch."
            ),
        }
    return card


def craft_goal(scenario: str, language: str | None = None) -> dict[str, Any]:
    """Emit plan_call inputs for a clean closing sequence."""
    if scenario not in CRAFT_SCENARIOS:
        raise ValueError(f"unknown scenario: {scenario!r}; expected one of {sorted(CRAFT_SCENARIOS)}")
    return {
        "skill": "call-closing-sequence-auditor",
        "mode": "craft",
        "scenario": scenario,
        "language": language or "en",
        "goal": CLEAN_CLOSING_GOAL,
        "notes": [
            "Heuristic skill: this template is a starting point; adapt wording to the case.",
            "Keep fictional fixtures offline; any host-run live call requires separate explicit intent and an authorized E.164 destination.",
        ],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    p_analyze = sub.add_parser("analyze", help="Audit the closing window of a finished CALL-E call result.")
    p_analyze.add_argument("--transcript", required=True, help="Path to a CALL-E call result JSON file.")
    p_analyze.add_argument("--out", default=None, help="Write the card to this path (default: stdout).")

    p_craft = sub.add_parser("craft", help="Emit a clean-closing goal for the next plan_call.")
    p_craft.add_argument("--scenario", required=True, help=f"One of {sorted(CRAFT_SCENARIOS)}.")
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
