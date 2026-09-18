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


VERIFICATION_FIRST_GOAL = (
    "You are calling a named recipient about a personal matter. Open by "
    "identifying yourself as an automated assistant and naming your "
    "organization. Then ask to speak to the recipient by name ('May I speak "
    "to <name>?'). Do not state the purpose of the call or any account, "
    "payment, medical, or policy detail until the recipient confirms their "
    "identity ('Am I speaking with <name>?'). If someone else answers, say "
    "only that you will call back later, offer to leave a callback number, "
    "and end the call without revealing the subject. After confirmation, "
    "state the matter in one sentence and proceed."
)

HUMAN_REVIEW_GUIDANCE = (
    "Verification ordering could not be established, or sensitive content "
    "may have reached someone other than the intended recipient. A human "
    "should read the transcript and decide whether to re-contact and what "
    "to disclose."
)

PROCEED_GUIDANCE = (
    "The intended recipient was confirmed before any sensitive content "
    "appeared. Continue the workflow."
)


def _has_side(turns: list[dict[str, str]], callee: bool) -> bool:
    for turn in turns:
        speaker = str(turn.get("speaker", "")).lower().strip()
        is_callee = speaker in CALLEE_ROLES
        if is_callee == callee and str(turn.get("text", "")).strip():
            return True
    return False


def build_gate_card(turns: list[dict[str, str]]) -> dict[str, Any]:
    """Audit verify-before-disclose ordering and build the gate card.

    Known accepted behavior: a callee asking "Who's calling?" fires
    third_party_signal; that is ambiguous between the recipient asking for
    clarification and an actual third party answering, so it only moves the
    verdict toward the cautious stop-and-retry or (with a later explicit
    confirmation) is superseded by CONFIRMED.
    """
    card: dict[str, Any] = {
        "skill": "call-right-party-gatekeeper",
        "analysis_mode": "heuristic",
        "gate_assessment": "assessed",
        "reason": None,
        "right_party_status": None,
        "verification_before_disclosure": False,
        "evidence": [],
        "recommended_action": {"action": "human_review", "guidance": None},
        "disclaimer": DISCLAIMER,
    }

    if not _has_side(turns, callee=False) or not _has_side(turns, callee=True):
        card["gate_assessment"] = "unclear"
        card["reason"] = "insufficient_signal"
        return card

    verification_idx: int | None = None
    disclosure_idx: int | None = None
    callee_signals: list[str] = []
    evidence: list[dict[str, Any]] = []
    for index, turn in enumerate(turns):
        speaker = str(turn.get("speaker", "")).lower().strip()
        text = str(turn.get("text", "")).strip()
        if not text:
            continue
        side = "callee" if speaker in CALLEE_ROLES else "agent"
        for signal in detect_signals(speaker, text):
            evidence.append(
                {
                    "turn_index": index,
                    "speaker": side,
                    "span": mask_pii(text),
                    "signal": signal,
                }
            )
            if signal == VERIFICATION_QUESTION and verification_idx is None:
                verification_idx = index
            if signal == SENSITIVE_DISCLOSURE and disclosure_idx is None:
                disclosure_idx = index
            if signal in {IDENTITY_CONFIRMATION, WRONG_PARTY_SIGNAL, THIRD_PARTY_SIGNAL}:
                callee_signals.append(signal)

    if WRONG_PARTY_SIGNAL in callee_signals:
        status = "WRONG_PARTY"
    elif IDENTITY_CONFIRMATION in callee_signals:
        status = "CONFIRMED"
    elif THIRD_PARTY_SIGNAL in callee_signals:
        status = "THIRD_PARTY_PRESENT"
    else:
        status = "UNVERIFIED"

    card["evidence"] = evidence
    card["right_party_status"] = status
    card["verification_before_disclosure"] = verification_idx is not None and (
        disclosure_idx is None or verification_idx < disclosure_idx
    )
    disclosure_violation = disclosure_idx is not None and not card["verification_before_disclosure"]

    if status == "CONFIRMED":
        action = "proceed" if card["verification_before_disclosure"] else "human_review"
    elif status == "WRONG_PARTY":
        action = "human_review" if disclosure_violation else "stop_and_retry_with_script"
    elif status == "THIRD_PARTY_PRESENT":
        action = "stop_and_retry_with_script"
    else:
        action = "human_review"

    guidance_map = {
        "proceed": PROCEED_GUIDANCE,
        "stop_and_retry_with_script": VERIFICATION_FIRST_GOAL,
        "human_review": HUMAN_REVIEW_GUIDANCE,
    }
    card["recommended_action"] = {"action": action, "guidance": guidance_map[action]}
    return card


CRAFT_SCENARIOS = {"sensitive-outreach"}


def craft_goal(scenario: str, language: str | None = None) -> dict[str, Any]:
    """Emit plan_call inputs for a verification-first outreach call."""
    if scenario not in CRAFT_SCENARIOS:
        raise ValueError(f"unknown scenario: {scenario!r}; expected one of {sorted(CRAFT_SCENARIOS)}")
    return {
        "skill": "call-right-party-gatekeeper",
        "mode": "craft",
        "scenario": scenario,
        "language": language or "en",
        "goal": VERIFICATION_FIRST_GOAL,
        "notes": [
            "Heuristic skill: this template is a starting point; adapt wording to the case.",
            "Use fictional +1 555-01xx numbers for any test calls.",
        ],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    p_analyze = sub.add_parser("analyze", help="Audit a finished CALL-E call result for verify-before-disclose ordering.")
    p_analyze.add_argument("--transcript", required=True, help="Path to a CALL-E call result JSON file.")
    p_analyze.add_argument("--out", default=None, help="Write the card to this path (default: stdout).")

    p_craft = sub.add_parser("craft", help="Emit a verification-first goal for the next plan_call.")
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
        payload = build_gate_card(data["turns"])
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
