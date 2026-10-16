#!/usr/bin/env python3
"""call-leading-question-guard - audit agent questions for leading forms.

Twin-mode heuristic skill:
  analyze  classify agent question sentences into TAG / NEGATIVE_INTERROGATIVE /
           PRESUPPOSITION / COERCIVE / OPEN / CLOSED, flag leading forms, and
           mark values affirmed under a leading question as tainted elicitation
  craft    emit a neutral-elicitation goal template for plan_call

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
    "Lexical question-form heuristics. A flagged form is not proof the "
    "answer was coerced - a confident person may genuinely agree. Findings "
    "route to review, never auto-invalidate a result."
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


# Value lexicons, shared between taint detection and value extraction.
_WEEKDAY_RE = re.compile(r"\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b", re.IGNORECASE)
_ORDINAL_RE = re.compile(r"\bthe ([0-9]{1,2})(?:st|nd|rd|th)\b", re.IGNORECASE)
_AMOUNT_RE = re.compile(r"[$]([0-9][0-9 ,./-]*[0-9]|[0-9])\b|\b([0-9][0-9 ,./-]*[0-9]|[0-9])\s+(?:dollars|usd)\b", re.IGNORECASE)
_TIME_RE = re.compile(r"\b(?:at\s+)?([0-9]{1,2})(?::([0-9]{2}))?\s*(a\.?m\.?|p\.?m\.?)\b", re.IGNORECASE)

# Split on sentence enders, but not inside "a.m."/"p.m." - abbreviation
# periods in a.m./p.m. are excluded from split points via a fixed-width
# lookbehind.
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])(?<![aApP]\.m\.)\s+(?=[A-Z])")

# Question-form families, checked in this exact order; first match wins.
_TAG_RE = re.compile(
    r"(?:,\s*(?:right|correct|yeah|okay)\s*\?*"
    r"|\b(?:will|won't|will not|can|can't|cannot|do|don't|do not|did|didn't|"
    r"did not|are|aren't|are not|is|isn't|is not|should|shouldn't|should not|"
    r"would|wouldn't|would not)\s+you\s*\?)$",
    re.IGNORECASE,
)
_NEGATIVE_INTERROGATIVE_RE = re.compile(
    r"^(?:don't|doesn't|didn't|can't|cannot|won't|wouldn't|shouldn't|aren't|"
    r"isn't|wasn't|weren't|do you not|did you not|are you not|is it not)\b",
    re.IGNORECASE,
)
_PRESUPPOSITION_RE = re.compile(r"\b(?:still|again|already|back to|continue to)\b", re.IGNORECASE)
_COERCIVE_RE = re.compile(
    r"\b(?:obviously|surely|of course|clearly)\b|you'd (?:want|better)|you must agree",
    re.IGNORECASE,
)
_OPEN_RE = re.compile(r"^\s*(?:what|when|where|which|why|how|who)\b", re.IGNORECASE)

_AFFIRMATION_RE = re.compile(
    r"\b(?:yes|yeah|yep|sure|correct|that's right|absolutely|fine|okay|of course)\b",
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


def classify_question(sentence: str) -> str:
    """Classify one question sentence into exactly one form family."""
    if _TAG_RE.search(sentence):
        return "TAG"
    if _NEGATIVE_INTERROGATIVE_RE.search(sentence):
        return "NEGATIVE_INTERROGATIVE"
    if _PRESUPPOSITION_RE.search(sentence):
        return "PRESUPPOSITION"
    if _COERCIVE_RE.search(sentence):
        return "COERCIVE"
    if _OPEN_RE.search(sentence):
        return "OPEN"
    return "CLOSED"


LEADING_KINDS = {"TAG", "NEGATIVE_INTERROGATIVE", "PRESUPPOSITION", "COERCIVE"}


def _agent_question_sentences(turns: list[dict[str, str]]) -> list[dict[str, Any]]:
    """Extract question sentences from agent turns only."""
    questions: list[dict[str, Any]] = []
    for index, turn in enumerate(turns):
        if str(turn.get("speaker", "")).lower().strip() in CALLEE_ROLES:
            continue
        text = str(turn.get("text", "")).strip()
        if not text:
            continue
        for sentence in _SENTENCE_SPLIT_RE.split(text):
            sentence = sentence.strip()
            if not sentence.endswith("?"):
                continue
            kind = classify_question(sentence)
            questions.append(
                {
                    "turn_index": index,
                    "kind": kind,
                    "leading": kind in LEADING_KINDS,
                    "sentence": mask_pii(sentence)[:160],
                }
            )
    return questions


def detect_taint(
    turns: list[dict[str, str]], questions: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Find values affirmed by the callee right after a leading question."""
    taints: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for question in questions:
        if not question["leading"]:
            continue
        i = question["turn_index"]
        for j in (i + 1, i + 2):
            if j >= len(turns):
                break
            turn = turns[j]
            if str(turn.get("speaker", "")).lower().strip() not in CALLEE_ROLES:
                continue
            text = str(turn.get("text", "")).strip()
            if not text:
                continue
            if not _AFFIRMATION_RE.search(text):
                continue
            values = extract_values(text)
            if not values:
                continue
            for kind, raw_value in values:
                value = mask_pii(raw_value)
                key = (value, j)
                if key in seen:
                    continue
                seen.add(key)
                taints.append(
                    {
                        "turn_index": j,
                        "question_kind": question["kind"],
                        "value": value,
                        "sentence": mask_pii(text)[:160],
                    }
                )
    return taints


NEUTRAL_GUIDANCE: dict[str, dict[str, Any]] = {
    "NEUTRAL_ELICITATION": {"action": "continue", "guidance": None},
    "LEADING_QUESTIONS_DETECTED": {
        "action": "review_question_forms",
        "guidance": (
            "Leading question forms were used. Prefer open-form questions at "
            "decision points; re-ask neutrally if a key value rests only on a "
            "leading question."
        ),
    },
    "LEADING_TAINTED": {
        "action": "reask_neutrally_before_booking",
        "guidance": (
            "At least one affirmed value came from a leading question. "
            "Re-confirm that value with a neutral question before it drives "
            "any booking or record update."
        ),
    },
    "NO_QUESTIONS_ASKED": {
        "action": "review_question_strategy",
        "guidance": (
            "The agent asked no questions at all this call; confirm the goal "
            "actually required none."
        ),
    },
}


def analyze_turns(turns: list[dict[str, str]]) -> dict[str, Any]:
    """Build the leading-question card from transcript turns."""
    card: dict[str, Any] = {
        "skill": "call-leading-question-guard",
        "analysis_mode": "heuristic",
        "elicitation_assessment": "assessed",
        "reason": None,
        "questions_total": 0,
        "questions": [],
        "tainted_elicitation": [],
        "verdict": "NEUTRAL_ELICITATION",
        "recommended_action": NEUTRAL_GUIDANCE["NEUTRAL_ELICITATION"],
        "disclaimer": DISCLAIMER,
    }

    if not turns:
        card["elicitation_assessment"] = "unclear"
        card["reason"] = "empty_transcript"
        card["verdict"] = None
        card["recommended_action"] = {"action": "continue", "guidance": None}
        return card

    has_agent_turn = any(
        str(t.get("speaker", "")).lower().strip() not in CALLEE_ROLES
        and str(t.get("text", "")).strip()
        for t in turns
    )
    if not has_agent_turn:
        card["elicitation_assessment"] = "unclear"
        card["reason"] = "insufficient_agent_signal"
        card["verdict"] = None
        card["recommended_action"] = {"action": "continue", "guidance": None}
        return card

    questions = _agent_question_sentences(turns)
    card["questions"] = questions
    card["questions_total"] = len(questions)

    if not questions:
        card["verdict"] = "NO_QUESTIONS_ASKED"
        card["recommended_action"] = NEUTRAL_GUIDANCE["NO_QUESTIONS_ASKED"]
        return card

    taints = detect_taint(turns, questions)
    card["tainted_elicitation"] = taints

    if taints:
        card["verdict"] = "LEADING_TAINTED"
    elif any(q["leading"] for q in questions):
        card["verdict"] = "LEADING_QUESTIONS_DETECTED"
    else:
        card["verdict"] = "NEUTRAL_ELICITATION"
    card["recommended_action"] = NEUTRAL_GUIDANCE[card["verdict"]]
    return card


NEUTRAL_ELICITATION_GOAL = (
    "Ask in neutral form. Open first: 'What day works best for you?' Let "
    "the person answer in their own words. Only then confirm in bounded "
    "closed form: 'Friday the 15th - should I book that?' Never end a "
    "decision question with a tag like 'right?' or 'won't you?'. Do not "
    "presuppose an answer ('are you still coming', 'obviously you'd "
    "prefer'). If the answer is no, accept it verbatim and move on - never "
    "re-ask a declined question in leading form."
)

CRAFT_SCENARIOS = {"neutral-elicitation"}


def craft_goal(scenario: str, language: str | None = None) -> dict[str, Any]:
    """Emit plan_call inputs for a neutral-elicitation call."""
    if scenario not in CRAFT_SCENARIOS:
        raise ValueError(f"unknown scenario: {scenario!r}; expected one of {sorted(CRAFT_SCENARIOS)}")
    return {
        "skill": "call-leading-question-guard",
        "mode": "craft",
        "scenario": scenario,
        "language": language or "en",
        "goal": NEUTRAL_ELICITATION_GOAL,
        "notes": [
            "Heuristic skill: this template is a starting point; adapt wording to the case.",
            "Keep fictional fixtures offline; any host-run live call requires separate explicit intent and an authorized E.164 destination.",
        ],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    p_analyze = sub.add_parser("analyze", help="Audit agent question forms in a finished CALL-E call result.")
    p_analyze.add_argument("--transcript", required=True, help="Path to a CALL-E call result JSON file.")
    p_analyze.add_argument("--out", default=None, help="Write the card to this path (default: stdout).")

    p_craft = sub.add_parser("craft", help="Emit a neutral-elicitation goal for the next plan_call.")
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
