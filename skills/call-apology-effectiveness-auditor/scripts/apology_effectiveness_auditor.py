#!/usr/bin/env python3
"""call-apology-effectiveness-auditor - grade agent apologies against grievance recovery.

Twin-mode heuristic skill:
  analyze  detect CALLEE grievances in a finished CALL-E transcript and grade
           the agent's apology against the six-component effectiveness
           taxonomy (acknowledgment, repair, explanation, regret,
           forbearance, forgiveness request) with a rote/empathic/
           explanatory typology
  craft    emit an apology-protocol goal template for plan_call

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
    "Lexical apology grading. A grievance lexicon hit is not proof of "
    "genuine distress; a component marker is not proof of sincerity; "
    "sometimes the right posture is no apology at all (the agent cannot "
    "own fault it does not have). Advisory for human review, not a "
    "relationship-quality certificate."
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
# periods excluded via fixed-width lookbehind).
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])(?<![aApP]\.m\.)\s+(?=[A-Z])")

# A callee turn matches the grievance lexicon when the person voices a
# complaint about service, delay, or a broken promise.
_GRIEVANCE_RE = re.compile(
    r"\b(?:not happy|unacceptable|ridiculous|third time|nobody called|"
    r"never received|never got|still waiting|waiting for|waited all|"
    r"waited two|waited three|waited four|waited half|waste of|"
    r"frustrat\w*|annoyed|angry|upset|complain\w*|you promised|"
    r"they promised)\b",
    re.IGNORECASE,
)

# An apology sentence in an agent turn, including intensified
# ("I'm so/truly/deeply/very sorry") and uncontracted ("I am sorry") forms.
_APOLOGY_RE = re.compile(
    r"\b(?:i'?m (?:so|truly|deeply|very)?\s*sorry|i am (?:so|truly|deeply|very)?\s*sorry|"
    r"i apologize|we apologize|our apologies|my apologies|sorry about|sorry that)\b",
    re.IGNORECASE,
)

# Deflection-style non-apologies: they apologize for the feeling, not the
# failure, and empirically deepen the grievance.
_DEFLECTION_RE = re.compile(
    r"\b(?:sorry you feel|sorry if you|apologize if you|"
    r"if you (?:were|felt|are) (?:upset|offended|inconvenienced))\b",
    re.IGNORECASE,
)

# Six apology components (Lewicki, Polin & Lount 2016), checked over the
# apology sentence plus the following agent turn (explanations arrive late).
_COMPONENT_RES: dict[str, re.Pattern[str]] = {
    "ACKNOWLEDGMENT": re.compile(
        r"(?:that'?s on us|our mistake|we got (?:that|it) wrong|"
        r"i take responsibility|that was our (?:error|fault)|we missed|our error)",
        re.IGNORECASE,
    ),
    "REPAIR": re.compile(
        r"(?:let me fix|i will send|we'?ll (?:send|reschedule|refund|call|email)|"
        r"make it right|here'?s what i'?ll do|i can (?:refund|reschedule|send|offer))",
        re.IGNORECASE,
    ),
    "EXPLANATION": re.compile(r"(?:\bbecause\b|the reason|what happened was)", re.IGNORECASE),
    "REGRET": re.compile(r"(?:truly sorry|so sorry|deeply sorry|we regret)", re.IGNORECASE),
    "FORBEARANCE": re.compile(
        r"(?:won'?t happen again|will not happen again|we'?ve changed|we'?ve fixed)",
        re.IGNORECASE,
    ),
    "FORGIVENESS_REQUEST": re.compile(r"(?:do you accept (?:my|our) apology)", re.IGNORECASE),
}
_COMPONENT_ORDER = [
    "ACKNOWLEDGMENT",
    "REPAIR",
    "EXPLANATION",
    "REGRET",
    "FORBEARANCE",
    "FORGIVENESS_REQUEST",
]

# Feeling acknowledgment (empathic typology marker).
_FEELING_ACK_RE = re.compile(
    r"(?:i understand (?:how|why)|i hear you|that must have been)",
    re.IGNORECASE,
)


def _normalize(text: str) -> str:
    return " ".join(str(text).split())


def _side(speaker: str) -> str:
    return "callee" if speaker.lower().strip() in CALLEE_ROLES else "agent"


def _first_sentence_matching(text: str, pattern: re.Pattern[str]) -> str | None:
    for sentence in _SENTENCE_SPLIT_RE.split(text):
        sentence = sentence.strip()
        if sentence and pattern.search(sentence):
            return sentence
    return None


APOLOGY_PROTOCOL_GOAL = (
    "When the person raises a grievance, respond with a real apology "
    "protocol. Acknowledge specifically: 'That's on us - we missed the "
    "callback we promised.' Offer concrete repair: 'Here is what I'll do: "
    "the nurse calls you today before 5.' Explain briefly only after "
    "acknowledging: 'It happened because the referral queue failed.' "
    "Never use 'I'm sorry you feel that way' or 'sorry if' constructions "
    "- they apologize for the feeling, not the failure. Ask nothing of "
    "the person beyond what the repair requires."
)

CRAFT_SCENARIOS = {"apology-protocol"}


def craft_goal(scenario: str, language: str | None = None) -> dict[str, Any]:
    """Emit plan_call inputs for a grievance-recovery call."""
    if scenario not in CRAFT_SCENARIOS:
        raise ValueError(f"unknown scenario: {scenario!r}; expected one of {sorted(CRAFT_SCENARIOS)}")
    return {
        "skill": "call-apology-effectiveness-auditor",
        "mode": "craft",
        "scenario": scenario,
        "language": language or "en",
        "goal": APOLOGY_PROTOCOL_GOAL,
        "notes": [
            "Heuristic skill: this template is a starting point; adapt wording to the case.",
            "Keep fictional fixtures offline; any host-run live call requires separate explicit intent and an authorized E.164 destination.",
        ],
    }


def analyze_turns(turns: list[dict[str, str]]) -> dict[str, Any]:
    """Detect callee grievances and grade the agent's apology response."""
    card: dict[str, Any] = {
        "skill": "call-apology-effectiveness-auditor",
        "analysis_mode": "heuristic",
        "apology_assessment": "assessed",
        "reason": None,
        "grievance_turn_index": None,
        "grievances_total": 0,
        "grievance_evidence": None,
        "apology_detected": False,
        "apology_evidence": None,
        "components_present": [],
        "typology": None,
        "verdict": None,
        "recommended_action": {"action": "continue", "guidance": None},
        "disclaimer": DISCLAIMER,
    }

    if not turns:
        card["apology_assessment"] = "unclear"
        card["reason"] = "empty_transcript"
        return card
    if len(turns) < 2:
        card["apology_assessment"] = "unclear"
        card["reason"] = "insufficient_signal"
        return card

    # Stage 1: grievance detection over callee turns only.
    normalized: list[tuple[str, str]] = [
        (_side(str(t.get("speaker", ""))), _normalize(t.get("text", ""))) for t in turns
    ]
    grievance_index: int | None = None
    grievances_total = 0
    for i, (side, text) in enumerate(normalized):
        if side != "callee" or not text:
            continue
        if _GRIEVANCE_RE.search(text):
            grievances_total += 1
            if grievance_index is None:
                grievance_index = i
    card["grievances_total"] = grievances_total

    if grievance_index is None:
        card["verdict"] = "NO_GRIEVANCE"
        card["recommended_action"] = {"action": "continue", "guidance": None}
        return card

    card["grievance_turn_index"] = grievance_index
    g_text = normalized[grievance_index][1]
    evidence_sentence = _first_sentence_matching(g_text, _GRIEVANCE_RE) or g_text
    card["grievance_evidence"] = mask_pii(evidence_sentence)[:160]

    # Stage 2: apology detection over agent turns from g onward.
    apology: tuple[int, str] | None = None
    for i in range(grievance_index, len(normalized)):
        side, text = normalized[i]
        if side != "agent" or not text:
            continue
        sentence = _first_sentence_matching(text, _APOLOGY_RE)
        if sentence:
            apology = (i, sentence)
            break

    if apology is None:
        card["verdict"] = "GRIEVANCE_UNADDRESSED"
        card["recommended_action"] = {
            "action": "escalate_to_human",
            "guidance": "The callee raised a grievance and the agent never apologized; a human should decide the recovery.",
        }
        return card

    card["apology_detected"] = True
    apology_index, apology_sentence = apology
    card["apology_evidence"] = mask_pii(apology_sentence)[:160]

    # Deflection override, checked first.
    if _DEFLECTION_RE.search(apology_sentence):
        card["verdict"] = "NON_APOLOGY"
        card["recommended_action"] = {
            "action": "escalate_to_human",
            "guidance": "A deflection-style non-apology risks deepening the grievance; a human should own the recovery.",
        }
        return card

    # Grade components over the apology sentence plus the following agent
    # turn (explanations often arrive one turn late).
    window_parts = [apology_sentence]
    window_parts.extend(
        s.strip()
        for s in _SENTENCE_SPLIT_RE.split(normalized[apology_index][1])
        if s.strip() and s.strip() != apology_sentence
    )
    for j in range(apology_index + 1, len(normalized)):
        if normalized[j][0] == "agent":
            window_parts.append(normalized[j][1])
            break
    window_text = " ".join(window_parts)

    components = [name for name in _COMPONENT_ORDER if _COMPONENT_RES[name].search(window_text)]
    card["components_present"] = components

    has_ack = "ACKNOWLEDGMENT" in components
    has_repair = "REPAIR" in components
    has_explanation = "EXPLANATION" in components

    # Typology precedence: empathic > explanatory > rote.
    if has_ack and _FEELING_ACK_RE.search(window_text):
        card["typology"] = "empathic"
    elif has_explanation:
        card["typology"] = "explanatory"
    else:
        card["typology"] = "rote"

    if has_ack and (has_repair or has_explanation):
        card["verdict"] = "EFFECTIVE_APOLOGY"
        card["recommended_action"] = {
            "action": "continue",
            "guidance": "Apology carried the components that matter; confirm the repair actually happened.",
        }
    else:
        card["verdict"] = "PARTIAL_APOLOGY"
        card["recommended_action"] = {
            "action": "reissue_proper_apology",
            "guidance": "The apology was thin. Name the miss specifically (acknowledgment), then offer a concrete repair or a brief explanation.",
        }
    return card


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    p_analyze = sub.add_parser("analyze", help="Grade the agent's apology in a finished CALL-E call result.")
    p_analyze.add_argument("--transcript", required=True, help="Path to a CALL-E call result JSON file.")
    p_analyze.add_argument("--out", default=None, help="Write the card to this path (default: stdout).")

    p_craft = sub.add_parser("craft", help="Emit an apology-protocol goal for the next plan_call.")
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
