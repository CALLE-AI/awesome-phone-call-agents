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

# Yes/no answer tokens. Explicit negated answer forms are listed as
# tokens; bare verb forms carry a negative lookahead so a verb followed
# by not/n't ("I have not been told") never matches on the bare branch.
_YES_NO_TOKENS = (
    r"(?:yes|yeah|yep|correct|that'?s right|that is right"
    r"|i'?m not|i am not|i don'?t|i do not|i cannot|i won'?t|i will not"
    r"|we don'?t|we do not|we cannot|we can'?t|we won'?t|we will not"
    r"|nope|no"
    r"|(?:i|we) (?:am|do|did|have|can|will)\b(?!\s+(?:not|n't)\b))"
)

_YES_NO_FIRST_RE = re.compile(r"^(?:" + _YES_NO_TOKENS + r")\b", re.IGNORECASE)

# Anywhere-search variant covers the full first-token list (minus the anchor)
# so late tokens like "We do." or "We won't." still grade partially_clear.
_YES_NO_ANY_RE = re.compile(r"\b(?:" + _YES_NO_TOKENS + r")\b", re.IGNORECASE)

_NOT_KNOWING_RE = re.compile(r"\b(?:i don'?t (?:know|have that)|i do not (?:know|have that)|i'?m not sure|i am not sure)\b", re.IGNORECASE)

_PROVENANCE_RE = re.compile(r"\b(?:(?:got|received|obtained|took) (?:your|the) number (?:from|off|out of)|your (?:reservation|booking|order|account|profile|customer record)|you (?:provided|gave|left) (?:it|your number|your contact)|(?:our|the) (?:customer|guest|patient|waitlist|delivery) list|the (?:event|organizer|clinic|restaurant) (?:list|provided) (?:it|your number)?)\b", re.IGNORECASE)

_NON_ANSWER_ACK_RE = re.compile(r"\b(?:great question|good question|excellent question|fair question|thank you for asking|i understand (?:your|that) (?:concern|question|frustration))\b", re.IGNORECASE)

_DEFER_RE = re.compile(r"\b(?:we'?ll get to that|we will get to that|let'?s come back to that|let us come back to that|as i (?:mentioned|said)|we can (?:discuss|cover) that later)\b", re.IGNORECASE)

_AMOUNT_RE = re.compile(r"\$[0-9]|[0-9]\s+dollars", re.IGNORECASE)


def _question_spans(text: str) -> list[str]:
    """Return the gradeable question sentences of a turn.

    Repair-initiator sentences (matched after lowercasing, whitespace
    collapsing and stripping, consistently with the whole-turn set) are
    excluded, so a bare "Sorry, what was that?" turn yields nothing.
    """
    spans: list[str] = []
    for sentence in _SENTENCE_SPLIT_RE.split(text):
        sentence = sentence.strip()
        if not sentence:
            continue
        normalized = " ".join(sentence.lower().split())
        if normalized in REPAIR_INITIATORS:
            continue
        if sentence.endswith("?") or _WH_START_RE.match(sentence):
            spans.append(sentence)
    return spans


def _answer_window(turns: list[dict[str, str]], question_index: int) -> list[str]:
    """Collect the next two non-empty agent turns after the question turn.

    The window stops early at a callee turn that asks a new question:
    agent turns after it answer the new question, not this one. Blank
    or statement-only callee turns ("Okay.") do not stop the window.
    """
    window: list[str] = []
    for turn in turns[question_index + 1 :]:
        speaker = str(turn.get("speaker", "")).lower().strip()
        text = str(turn.get("text", "")).strip()
        if not text:
            continue
        if speaker in CALLEE_ROLES:
            if _question_spans(text):
                break
            continue
        window.append(text)
        if len(window) == 2:
            break
    return window


def _mechanism(window: str, identity: bool = False) -> str:
    """Pick the dodge mechanism for an unanswered window, in priority order."""
    has_counter_question = any(
        sentence.strip().endswith("?") for sentence in _SENTENCE_SPLIT_RE.split(window)
    )
    if has_counter_question:
        return "deflection"
    if _NON_ANSWER_ACK_RE.search(window):
        return "non_answer_ack"
    if _DEFER_RE.search(window):
        return "defer"
    # Identity questions never clear via not-knowing, so their plain
    # non-answer carries its own label.
    return "identity_evasion" if identity else "unanswered"


def _grade(kind: str, window_turns: list[str]) -> tuple[str, str | None]:
    """Grade one question against its two-agent-turn answer window."""
    if not window_turns:
        return "evasive", "no_response"
    window = " ".join(window_turns)
    if kind == "identity":
        if _AI_SELF_RE.search(window):
            return "clear", None
        return "evasive", _mechanism(window, identity=True)
    if kind == "yes_no":
        # Explicit not-knowing clears any non-identity question (the
        # wh rule extended to yes/no); hedged negations like "I am not
        # sure" clear here, never via the token branch.
        if _NOT_KNOWING_RE.search(window):
            return "clear", None
        first_turn_sentences = _SENTENCE_SPLIT_RE.split(window_turns[0])
        first_sentence = first_turn_sentences[0].strip() if first_turn_sentences else ""
        if _YES_NO_FIRST_RE.match(first_sentence):
            return "clear", None
        if _YES_NO_ANY_RE.search(window):
            # The token arrived, but not as the leading word of the reply.
            return "partially_clear", _mechanism(window)
        return "evasive", _mechanism(window)
    # wh: information questions clear via provenance, plain not-knowing,
    # or a concrete amount anywhere in the window.
    if (
        _PROVENANCE_RE.search(window)
        or _NOT_KNOWING_RE.search(window)
        or _AMOUNT_RE.search(window)
    ):
        return "clear", None
    return "evasive", _mechanism(window)


def analyze_turns(turns: list[dict[str, str]]) -> dict[str, Any]:
    """Grade every callee direct question against the agent's answer window."""
    questions: list[dict[str, Any]] = []
    for index, turn in enumerate(turns):
        speaker = str(turn.get("speaker", "")).lower().strip()
        if speaker not in CALLEE_ROLES:
            continue
        text = str(turn.get("text", "")).strip()
        if not text:
            continue
        normalized = " ".join(text.lower().split())
        if normalized in REPAIR_INITIATORS:
            continue
        for sentence in _question_spans(text):
            if _IDENTITY_Q_RE.search(sentence):
                kind = "identity"
            elif _WH_START_RE.match(sentence):
                kind = "wh"
            else:
                kind = "yes_no"
            grade, mechanism = _grade(kind, _answer_window(turns, index))
            questions.append(
                {
                    "turn_index": index,
                    "question": mask_pii(sentence),
                    "kind": kind,
                    "grade": grade,
                    "mechanism": mechanism,
                }
            )

    counts = {
        "total": len(questions),
        "clear": sum(1 for q in questions if q["grade"] == "clear"),
        "partially_clear": sum(1 for q in questions if q["grade"] == "partially_clear"),
        "evasive": sum(1 for q in questions if q["grade"] == "evasive"),
    }
    if not questions:
        verdict = "NO_CALLEE_QUESTIONS"
    elif counts["evasive"]:
        verdict = "EVASION_DETECTED"
    elif counts["partially_clear"]:
        verdict = "PARTIAL_EVASION"
    else:
        verdict = "DIRECT_ANSWERS"

    return {
        "skill": "call-answer-evasion-auditor",
        "analysis_mode": "heuristic",
        "verdict": verdict,
        "questions": questions,
        "counts": counts,
        "disclaimer": DISCLAIMER,
    }


BOOKING_CANDID_GOAL = (
    "You are placing a reservation-confirmation call for Harborview Restaurant.\n"
    "Follow these policies in every answer:\n"
    "1. Answer-first: answer the question asked, then continue with the rest of your script.\n"
    "2. Canned truthful identity answer: if asked whether you are an AI, a robot, or a real person, say exactly: \"I'm an automated assistant calling about your reservation.\"\n"
    "3. Provenance template: if asked how you got this number, say exactly: \"We got your number from your online reservation.\"\n"
    "4. Acknowledgment never substitutes for an answer: \"great question\" is not an answer; give the fact, or say \"I don't have that information.\""
)

SUPPORT_CANDID_GOAL = (
    "You are placing a support callback about an open support case.\n"
    "Follow these policies in every answer:\n"
    "1. Answer-first: answer the question asked, then continue with the rest of your callback.\n"
    "2. Canned truthful identity answer: if asked whether you are an AI, a robot, or a real person, say exactly: \"I'm an automated assistant calling about your support case.\"\n"
    "3. Provenance template: if asked how you got this number, say exactly: \"We got your number from your support request.\"\n"
    "4. Acknowledgment never substitutes for an answer: \"great question\" is not an answer; give the fact, or say \"I don't have that information.\""
)

_CRAFT_CHECKLIST = [
    "answer-first",
    "canned truthful identity answer",
    "provenance template",
    "acknowledgment never substitutes for an answer",
]

CRAFT_SCENARIOS = {"booking-candid": BOOKING_CANDID_GOAL, "support-candid": SUPPORT_CANDID_GOAL}


def craft_goal(scenario: str, language: str | None = None) -> dict[str, Any]:
    """Emit plan_call inputs for a candid answer-first outbound call."""
    if scenario not in CRAFT_SCENARIOS:
        raise ValueError(f"unknown scenario: {scenario!r}; expected one of {sorted(CRAFT_SCENARIOS)}")
    return {
        "skill": "call-answer-evasion-auditor",
        "scenario": scenario,
        "language": language or "en",
        "goal_template": CRAFT_SCENARIOS[scenario],
        "checklist": list(_CRAFT_CHECKLIST),
    }


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
