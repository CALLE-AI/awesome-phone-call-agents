#!/usr/bin/env python3
"""call-disfluency-stress-profiler - detect abnormal disfluency rates in CALL-E transcripts.

Twin-mode heuristic skill:
  analyze  scan each speaker side of a transcript for filled pauses (uh, um,
           er), self-repairs (I mean, actually, repetition), and hesitation
           sequences (well..., so...). Compute per-side disfluency rates and
           emit a stress/hesitancy card.
  craft    emit a reassurance-followup goal template for the next plan_call

Runs offline, deterministic, no LLM, no network. Input errors exit 2.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

CALLEE_ROLES = {"callee", "customer", "patient", "caller", "recipient", "user"}

DISCLAIMER = (
    "Heuristic text-only disfluency analysis. A high disfluency rate may "
    "reflect genuine stress, unfamiliar topics, or natural speech style; "
    "a low rate does not prove engagement. Findings are advisory and route "
    "to human review, never to automatic action."
)

# ---------------------------------------------------------------- PII masking

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


# ---------------------------------------------------------------- transcript loading


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


# ---------------------------------------------------------------- disfluency lexicon

# Filled pauses — standalone interjections.
# Uses word-boundary anchors to avoid false matches inside words.
_FILLED_PAUSE_RE = re.compile(
    r"\b(?:uh+|um+|er+|eh+|ah+|hmm+|hm+)\b"
    r"|(?<![a-z])like(?!\s+(?:a|an|the|this|that|it|to|I|you|we|they|he|she))",
    re.IGNORECASE,
)

# Self-repair markers — speaker corrects or restates.
_SELF_REPAIR_RE = re.compile(
    r"\b(?:I mean|what I mean|what I said|actually|no wait|wait,? let me|"
    r"I should say|to rephrase|more precisely|in other words)\b",
    re.IGNORECASE,
)

# Repetition — same word/short phrase repeated consecutively (edge case: "I I", "the the").
_REPETITION_RE = re.compile(r"\b(\w+)\s+\1\b", re.IGNORECASE)

# Hesitation openers — filler words at the start of a turn or clause.
_HESITATION_OPENER_RE = re.compile(
    r"(?:^|\.\s+|\?\s+|\!\s+)(?:well,?\s|so,?\s|you know,?\s|you see,?\s|"
    r"look,?\s|right,?\s+so\s|okay so\s)",
    re.IGNORECASE,
)

# Threshold for flagging a side as stressed/hesitant.
# Disfluency rate = total markers / total word count.
CALLEE_STRESS_THRESHOLD = 0.08   # 8%  — callee stress
AGENT_HESITANT_THRESHOLD = 0.06  # 6%  — agent knowledge-gap hesitancy


def _count_disfluencies(text: str) -> int:
    """Count all disfluency markers in a text string."""
    filled = len(_FILLED_PAUSE_RE.findall(text))
    repairs = len(_SELF_REPAIR_RE.findall(text))
    repetitions = len(_REPETITION_RE.findall(text))
    hesitations = len(_HESITATION_OPENER_RE.findall(text))
    return filled + repairs + repetitions + hesitations


def _word_count(text: str) -> int:
    return len(text.split())


# ---------------------------------------------------------------- craft templates

_CRAFT_GOAL = (
    "You are making a follow-up phone call after a previous interaction "
    "where the contact appeared stressed or uncertain. Adopt a calm, "
    "unhurried tone. Speak in short, clear sentences. Pause briefly after "
    "each question to give the contact time to respond without feeling "
    "rushed. If the contact interrupts or speaks quickly, slow your pace "
    "and acknowledge their concern explicitly before continuing. Do not "
    "ask more than one question per turn. End the call by confirming that "
    "the contact's needs have been understood and offer a clear next step."
)

CRAFT_SCENARIOS = {"reassurance-followup"}


def craft_goal(scenario: str, language: str | None = None) -> dict[str, Any]:
    """Emit plan_call inputs for a reassurance-paced follow-up call."""
    if scenario not in CRAFT_SCENARIOS:
        raise ValueError(f"unknown scenario: {scenario!r}; expected one of {sorted(CRAFT_SCENARIOS)}")
    return {
        "skill": "call-disfluency-stress-profiler",
        "mode": "craft",
        "scenario": scenario,
        "language": language or "en",
        "goal": _CRAFT_GOAL,
        "notes": [
            "Heuristic skill: adapt the goal text to the specific context of the previous call.",
            "Keep fictional fixtures offline; any host-run live call requires separate explicit intent and an authorized E.164 destination.",
        ],
    }


# ---------------------------------------------------------------- analysis


def _profile_side(turns_texts: list[str]) -> dict[str, Any]:
    """Compute aggregate disfluency stats for one side (agent or callee)."""
    total_words = 0
    total_markers = 0
    per_turn: list[dict[str, Any]] = []
    for i, text in enumerate(turns_texts):
        wc = _word_count(text)
        mc = _count_disfluencies(text)
        total_words += wc
        total_markers += mc
        per_turn.append({"turn_index": i, "word_count": wc, "marker_count": mc})
    rate = round(total_markers / total_words, 4) if total_words > 0 else 0.0
    return {
        "total_words": total_words,
        "total_markers": total_markers,
        "disfluency_rate": rate,
        "per_turn_counts": per_turn,
    }


def analyze_transcript(turns: list[dict[str, str]]) -> dict[str, Any]:
    """Build the disfluency stress card from transcript turns."""
    card: dict[str, Any] = {
        "skill": "call-disfluency-stress-profiler",
        "analysis_mode": "heuristic",
        "disfluency_assessment": "assessed",
        "reason": None,
        "agent_profile": {},
        "callee_profile": {},
        "verdict": "NORMAL",
        "flags": [],
        "recommended_action": {"action": "no_action_required", "guidance": None},
        "disclaimer": DISCLAIMER,
    }

    if not turns:
        card["disfluency_assessment"] = "unclear"
        card["reason"] = "empty_transcript"
        return card

    agent_texts = [
        str(t.get("text", "")).strip()
        for t in turns
        if str(t.get("speaker", "")).lower().strip() not in CALLEE_ROLES
        and str(t.get("text", "")).strip()
    ]
    callee_texts = [
        str(t.get("text", "")).strip()
        for t in turns
        if str(t.get("speaker", "")).lower().strip() in CALLEE_ROLES
        and str(t.get("text", "")).strip()
    ]

    if not agent_texts and not callee_texts:
        card["disfluency_assessment"] = "unclear"
        card["reason"] = "no_speaker_turns"
        return card

    agent_profile = _profile_side(agent_texts) if agent_texts else {}
    callee_profile = _profile_side(callee_texts) if callee_texts else {}
    card["agent_profile"] = agent_profile
    card["callee_profile"] = callee_profile

    flags: list[str] = []
    if callee_profile and callee_profile.get("disfluency_rate", 0) >= CALLEE_STRESS_THRESHOLD:
        flags.append("CALLEE_STRESSED")
    if agent_profile and agent_profile.get("disfluency_rate", 0) >= AGENT_HESITANT_THRESHOLD:
        flags.append("AGENT_HESITANT")

    card["flags"] = flags

    if "CALLEE_STRESSED" in flags and "AGENT_HESITANT" in flags:
        card["verdict"] = "BOTH_STRESSED"
        card["recommended_action"] = {
            "action": "reassurance_followup_and_script_review",
            "guidance": (
                f"Callee disfluency rate {callee_profile['disfluency_rate']:.1%} exceeds threshold "
                f"({CALLEE_STRESS_THRESHOLD:.0%}): contact may be stressed. "
                f"Agent disfluency rate {agent_profile['disfluency_rate']:.1%} exceeds threshold "
                f"({AGENT_HESITANT_THRESHOLD:.0%}): agent may have encountered topics outside its script. "
                "Use craft mode to generate a reassurance follow-up goal AND review the agent script."
            ),
        }
    elif "CALLEE_STRESSED" in flags:
        card["verdict"] = "CALLEE_STRESSED"
        card["recommended_action"] = {
            "action": "reassurance_followup",
            "guidance": (
                f"Callee disfluency rate {callee_profile['disfluency_rate']:.1%} exceeds threshold "
                f"({CALLEE_STRESS_THRESHOLD:.0%}). Contact may be stressed or overwhelmed. "
                "Use craft mode to generate a reassurance-paced follow-up call goal."
            ),
        }
    elif "AGENT_HESITANT" in flags:
        card["verdict"] = "AGENT_HESITANT"
        card["recommended_action"] = {
            "action": "review_agent_script",
            "guidance": (
                f"Agent disfluency rate {agent_profile['disfluency_rate']:.1%} exceeds threshold "
                f"({AGENT_HESITANT_THRESHOLD:.0%}). Agent may have encountered questions outside its "
                "script or knowledge base. Review the call goal and consider updating the agent's "
                "knowledge before the next call."
            ),
        }
    else:
        card["recommended_action"] = {
            "action": "no_action_required",
            "guidance": "Disfluency rates are within normal range on both sides.",
        }

    return card


# ---------------------------------------------------------------- CLI


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    p_analyze = sub.add_parser("analyze", help="Profile disfluency rates in a finished CALL-E call result.")
    p_analyze.add_argument("--transcript", required=True, help="Path to a CALL-E call result JSON file.")
    p_analyze.add_argument("--out", default=None, help="Write the card to this path (default: stdout).")

    p_craft = sub.add_parser("craft", help="Emit a reassurance-followup goal for the next plan_call.")
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
        payload = analyze_transcript(data["turns"])
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
