#!/usr/bin/env python3
"""call-ai-disclosure-comprehension-auditor - audit AI disclosure and its comprehension in CALL-E transcripts.

Twin-mode heuristic skill:
  analyze  grade whether the agent disclosed being an AI, whether that
           disclosure was elicited for comprehension, and whether the
           callee acknowledged it
  craft    emit a disclosure-first goal template for the next plan_call

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
    "Heuristic text-only analysis. Absence of a captured acknowledgment "
    "does not prove the person failed to understand - people understand "
    "and stay silent all the time. This card measures what the transcript "
    "shows, offers compliance-routing advice, and is not legal advice."
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


# Disclosure lexicon: phrasings that tell the contacted person an AI is
# speaking. Grounded in Article 50 of Regulation (EU) 2024/1689 (inform
# natural persons they are interacting with an AI system; applicable from
# 2026-08-02) and disclosure-outcome research (Chen et al., CHB 2024;
# Chen, Sun et al., IP&M 2026 meta-analysis).
_DISCLOSURE_RE = re.compile(
    r"\bautomated assistant\b|"
    r"\bai (?:assistant|program|agent|system|calling service)\b|"
    r"\bi(?:'| a)m an? (?:ai|automated|artificial intelligence|virtual assistant)\b|"
    r"\bthis is an? (?:ai|automated|virtual) (?:assistant|system|service|calling)\b|"
    r"\bnot a (?:real )?(?:human|person)\b|"
    r"\bautomated (?:system|service|voice|calling system)\b|"
    r"\bartificial intelligence\b",
    re.IGNORECASE,
)

# Comprehension-check lexicon: an explicit question inviting the person to
# acknowledge the disclosure. Counted only in the disclosure turn or the
# next agent turn.
_CHECK_RE = re.compile(
    r"\bdo you understand\b|"
    r"\bdoes that make sense\b|"
    r"\bis that (?:okay|alright|fine)(?: with you)?\b|"
    r"\bare you (?:okay|comfortable|fine) (?:with|about) (?:that|this|continuing)\b|"
    r"\bare you happy to continue\b|"
    r"\bokay to continue\b|"
    r"\bany questions (?:about that|so far)\b",
    re.IGNORECASE,
)

# Acknowledgment lexicon: affirmative callee replies.
_ACK_RE = re.compile(
    r"\b(?:yes|yeah|yep|okay|ok|sure|fine|alright|i understand|understood|"
    r"that(?:'| i)s (?:fine|okay|okay by me)|no problem|go ahead|got it|"
    r"of course|certainly)\b",
    re.IGNORECASE,
)


def find_disclosure(turns: list[dict[str, str]]) -> dict[str, Any]:
    """Find the first agent disclosure turn and whether it was early."""
    first_agent_index = None
    disclosure_index = None
    disclosure_span = None
    for index, turn in enumerate(turns):
        speaker = str(turn.get("speaker", "")).lower().strip()
        text = str(turn.get("text", "")).strip()
        if speaker not in CALLEE_ROLES and text:
            if first_agent_index is None:
                first_agent_index = index
            if disclosure_index is None:
                m = _DISCLOSURE_RE.search(text)
                if m:
                    disclosure_index = index
                    disclosure_span = mask_pii(text)
    return {
        "first_agent_index": first_agent_index,
        "disclosure_index": disclosure_index,
        "disclosure_span": disclosure_span,
        "is_early": disclosure_index is not None and disclosure_index == first_agent_index,
    }


def find_comprehension_check(turns: list[dict[str, str]], disclosure_index: int) -> dict[str, Any]:
    """Find a comprehension-check question in the disclosure turn or the next agent turn.

    The check only counts when it happens BEFORE substantive business
    content: digits (dates, amounts, times) in the disclosure turn or the
    check turn itself mean the pitch came first, so the check is treated
    as absent for comprehension purposes.
    """
    agent_after = [
        i
        for i, t in enumerate(turns)
        if str(t.get("speaker", "")).lower().strip() not in CALLEE_ROLES
        and str(t.get("text", "")).strip()
    ]
    eligible = [i for i in agent_after if disclosure_index <= i]
    # Only the disclosure turn itself and the immediately following agent turn.
    if len(eligible) >= 2:
        eligible = eligible[:2]
    # Business content already delivered inside the disclosure turn
    # disqualifies the whole window: the pitch preceded the check.
    disclosure_text = str(turns[disclosure_index].get("text", "")).strip()
    if re.search(r"[0-9]", disclosure_text):
        return {"check_index": None, "check_span": None}
    for i in eligible:
        text = str(turns[i].get("text", "")).strip()
        if re.search(r"[0-9]", text):
            continue
        if _CHECK_RE.search(text):
            return {"check_index": i, "check_span": mask_pii(text)}
    return {"check_index": None, "check_span": None}


def find_acknowledgment(turns: list[dict[str, str]], check_index: int) -> dict[str, Any]:
    """Find the first affirmative callee reply after the check turn."""
    for i in range(check_index + 1, len(turns)):
        speaker = str(turns[i].get("speaker", "")).lower().strip()
        text = str(turns[i].get("text", "")).strip()
        if speaker in CALLEE_ROLES and text:
            if _ACK_RE.search(text):
                return {"ack_index": i, "ack_span": mask_pii(text)}
            # The first substantive callee reply after the check that is not
            # an acknowledgment ends the window.
            return {"ack_index": None, "ack_span": None}
    return {"ack_index": None, "ack_span": None}


DISCLOSURE_GOAL = (
    "You are an automated assistant - an AI program - placing this call. "
    "Say so in your FIRST sentence, in plain words: who you are, that you "
    "are an automated assistant, and who you are calling on behalf of. "
    "Then ask one short comprehension question, for example 'Do you "
    "understand that you are talking to an automated assistant?', and "
    "pause for the answer before anything else. If the person asks what "
    "that means, explain in one sentence and ask again. Only after the "
    "person acknowledges do you continue to the reason for the call. If "
    "the person objects to talking to an AI at any point, offer to have a "
    "human colleague call back instead."
)

CRAFT_SCENARIOS = {"disclosure-first-call"}


def craft_goal(scenario: str, language: str | None = None) -> dict[str, Any]:
    """Emit plan_call inputs for a disclosure-first outbound call."""
    if scenario not in CRAFT_SCENARIOS:
        raise ValueError(f"unknown scenario: {scenario!r}; expected one of {sorted(CRAFT_SCENARIOS)}")
    return {
        "skill": "call-ai-disclosure-comprehension-auditor",
        "mode": "craft",
        "scenario": scenario,
        "language": language or "en",
        "goal": DISCLOSURE_GOAL,
        "notes": [
            "Heuristic skill: this template is a starting point; adapt wording to the case.",
            "Keep fictional fixtures offline; any host-run live call requires separate explicit intent and an authorized E.164 destination.",
        ],
    }


def analyze_turns(turns: list[dict[str, str]]) -> dict[str, Any]:
    """Build the disclosure comprehension card from normalized turns."""
    card: dict[str, Any] = {
        "skill": "call-ai-disclosure-comprehension-auditor",
        "analysis_mode": "heuristic",
        "disclosure_assessment": "assessed",
        "reason": None,
        "disclosure_present": False,
        "disclosure_early": False,
        "comprehension_check_present": False,
        "acknowledgment_captured": False,
        "evidence": [],
        "verdict": "UNDISCLOSED",
        "recommended_action": {"action": "human_review", "guidance": None},
        "disclaimer": DISCLAIMER,
    }

    if not turns:
        card["disclosure_assessment"] = "unclear"
        card["reason"] = "empty_transcript"
        card["recommended_action"] = {
            "action": "human_review",
            "guidance": "The transcript contains no turns; there is nothing to audit.",
        }
        return card

    disclosure = find_disclosure(turns)
    if disclosure["first_agent_index"] is None:
        card["disclosure_assessment"] = "unclear"
        card["reason"] = "insufficient_agent_signal"
        card["recommended_action"] = {
            "action": "human_review",
            "guidance": "No agent-side turns exist; disclosure cannot be assessed.",
        }
        return card

    if disclosure["disclosure_index"] is None:
        card["evidence"] = []
        card["recommended_action"] = {
            "action": "redial_with_disclosure_goal",
            "guidance": (
                "No AI disclosure was found in any agent turn. Use the craft mode goal for "
                "future calls; for this record, a human must decide what to tell the person."
            ),
        }
        return card

    card["disclosure_present"] = True
    card["disclosure_early"] = disclosure["is_early"]
    evidence = [
        {
            "kind": "disclosure",
            "turn_index": disclosure["disclosure_index"],
            "span": disclosure["disclosure_span"][:160],
        }
    ]

    check = find_comprehension_check(turns, disclosure["disclosure_index"])
    ack = {"ack_index": None, "ack_span": None}
    if check["check_index"] is not None:
        card["comprehension_check_present"] = True
        evidence.append({"kind": "comprehension_check", "turn_index": check["check_index"], "span": check["check_span"][:160]})
        ack = find_acknowledgment(turns, check["check_index"])
        if ack["ack_index"] is not None:
            card["acknowledgment_captured"] = True
            evidence.append({"kind": "acknowledgment", "turn_index": ack["ack_index"], "span": ack["ack_span"][:160]})

    card["evidence"] = evidence

    if not disclosure["is_early"]:
        card["verdict"] = "LATE_DISCLOSURE"
        card["recommended_action"] = {
            "action": "redial_with_disclosure_goal",
            "guidance": (
                "The disclosure arrived after the agent's first speaking turn. Move it to "
                "the opening line; a person must know an AI is speaking before the pitch."
            ),
        }
    elif not card["comprehension_check_present"]:
        card["verdict"] = "DISCLOSED_NO_CHECK"
        card["recommended_action"] = {
            "action": "elicit_acknowledgment_next_call",
            "guidance": (
                "The agent disclosed but never checked the person understood. Next contact: "
                "pair the disclosure with one short comprehension question."
            ),
        }
    elif not card["acknowledgment_captured"]:
        card["verdict"] = "PARTIAL_NO_ACK"
        card["recommended_action"] = {
            "action": "elicit_acknowledgment_next_call",
            "guidance": (
                "A comprehension question was asked but no affirmative reply is visible in "
                "the transcript. The person may have understood silently; re-check on the "
                "next contact rather than assuming."
            ),
        }
    else:
        card["verdict"] = "FULL"
        card["recommended_action"] = {
            "action": "continue",
            "guidance": "Disclosure was early, checked, and acknowledged.",
        }
    return card


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    p_analyze = sub.add_parser("analyze", help="Audit disclosure and comprehension in a finished CALL-E call result.")
    p_analyze.add_argument("--transcript", required=True, help="Path to a CALL-E call result JSON file.")
    p_analyze.add_argument("--out", default=None, help="Write the card to this path (default: stdout).")

    p_craft = sub.add_parser("craft", help="Emit a disclosure-first goal for the next plan_call.")
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
