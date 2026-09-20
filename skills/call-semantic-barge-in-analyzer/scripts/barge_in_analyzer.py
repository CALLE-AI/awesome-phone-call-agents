#!/usr/bin/env python3
"""call-semantic-barge-in-analyzer - profile callee cooperation and pacing.

Twin-mode heuristic skill:
  analyze  classify callee turns into backchannels / barge-ins / substantive
  craft    emit a pacing goal template for the next plan_call

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
    "Heuristic text-only analysis. Backchannels and barge-ins are phrased "
    "in many ways this lexicon does not cover; profiles are pacing advice "
    "for the next call, not judgments about the person."
)


# A candidate is a digit run in which every separator (space, dash, dot,
# comma, slash) sits BETWEEN two ASCII digits. That prevents trailing
# separators from being masked and keeps "10:00" or "3rd" untouched because
# their digit runs are shorter than 7. ASCII [0-9] only, never \\d.
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

# Turn classification. A callee turn is one of:
#   backchannel  short listening sound after an agent STATEMENT ("Mm-hmm.")
#   barge_in     frustration / hold language anywhere in the turn
#   substantive  everything else, including short answers to agent QUESTIONS
# The question-vs-statement rule: a short vocabulary turn that answers a
# trailing-question agent turn is an ANSWER, not a backchannel. Bare "look"
# is deliberately NOT a barge-in marker ("I will look into that").
BACKCHANNEL = "backchannel"
BARGE_IN = "barge_in"
SUBSTANTIVE = "substantive"

_BARGE_IN_RE = re.compile(
    r"\b(?:wait(?! (?:for|until|till)\b)|hold on|hang on|stop(?! (?:by|at|in)\b)|"
    r"enough|listen,|slow down|too fast|"
    r"one at a time|let me (?:write|say|ask|finish|talk)|you'?re going too)\b",
    re.IGNORECASE,
)
_QUESTION_END_RE = re.compile(r"\?[\"'\u201d\u2019)\s]*$")
_TOKENS_RE = re.compile(r"[a-z'-]+")

# A turn counts as a backchannel only if it is at most 4 words and every
# word is listening vocabulary. "yes"/"sure" are included for the statement
# case; the question rule above keeps them as answers when they answer one.
BACKCHANNEL_WORDS = {
    "mm", "mm-hmm", "mmm", "hmm", "mhm", "uh-huh", "yeah", "yep", "yup",
    "yes", "right", "ok", "okay", "sure", "got", "it", "i", "see", "makes",
    "sense", "sounds", "good", "go", "on", "keep", "going", "please",
    "continue", "of", "course", "that", "works",
}


def _is_backchannel_text(text: str) -> bool:
    tokens = _TOKENS_RE.findall(text.lower())
    return 0 < len(tokens) <= 4 and all(token in BACKCHANNEL_WORDS for token in tokens)


def classify_callee_turn(text: str, previous_agent_text: str) -> str:
    """Classify one callee turn given the agent turn immediately before it."""
    if _BARGE_IN_RE.search(text):
        return BARGE_IN
    if _is_backchannel_text(text):
        if _QUESTION_END_RE.search(previous_agent_text or ""):
            return SUBSTANTIVE
        return BACKCHANNEL
    return SUBSTANTIVE


PACING_GOAL = (
    "You are calling someone who previously showed frustration with long "
    "explanations. Speak at most two sentences per turn, then pause for a "
    "reply. After each key point, invite a confirmation ('Does that make "
    "sense?'). If the person says 'wait', 'hold on', or asks you to slow "
    "down, stop immediately, acknowledge them, and let them speak. Restate "
    "your understanding in one sentence before closing."
)

MAINTAIN_GUIDANCE = (
    "The callee engaged with short confirmations and full answers. Keep the "
    "current chunked pacing: short statements with room to acknowledge."
)

PAUSE_AND_CONFIRM_GUIDANCE = (
    "The callee neither encouraged nor interrupted. Invite participation: "
    "ask direct questions, pause after each point, and confirm understanding "
    "before moving on."
)


def _is_callee(speaker: str) -> bool:
    return str(speaker).lower().strip() in CALLEE_ROLES


def build_pacing_card(turns: list[dict[str, str]]) -> dict[str, Any]:
    """Classify callee turns, compute pacing metrics, build the card."""
    card: dict[str, Any] = {
        "skill": "call-semantic-barge-in-analyzer",
        "analysis_mode": "heuristic",
        "pacing_assessment": "assessed",
        "reason": None,
        "cooperation_profile": None,
        "metrics": {},
        "evidence": [],
        "pacing_recommendation": {"recommendation": "pause_and_confirm", "guidance": PAUSE_AND_CONFIRM_GUIDANCE},
        "disclaimer": DISCLAIMER,
    }

    classifications: list[tuple[int, str, str]] = []  # (turn_index, side, classification)
    agent_word_counts: list[tuple[int, int]] = []  # (turn_index, word_count)
    previous_agent_text = ""
    for index, turn in enumerate(turns):
        speaker = str(turn.get("speaker", ""))
        text = str(turn.get("text", "")).strip()
        if not text:
            continue
        if _is_callee(speaker):
            classification = classify_callee_turn(text, previous_agent_text)
            classifications.append((index, "callee", classification))
            previous_agent_text = ""
        else:
            agent_word_counts.append((index, len(text.split())))
            previous_agent_text = text

    callee_classes = [c for _, side, c in classifications if side == "callee"]
    backchannel_count = callee_classes.count(BACKCHANNEL)
    barge_in_count = callee_classes.count(BARGE_IN)
    substantive_count = callee_classes.count(SUBSTANTIVE)
    callee_turns = len(callee_classes)

    if callee_turns == 0:
        card["pacing_assessment"] = "unclear"
        card["reason"] = "insufficient_callee_signal"
        return card

    evidence = [
        {
            "turn_index": index,
            "speaker": "callee",
            "span": mask_pii(str(turns[index].get("text", ""))),
            "classification": classification,
        }
        for index, side, classification in classifications
        if classification in {BACKCHANNEL, BARGE_IN}
    ]

    first_barge_index = next((i for i, _, c in classifications if c == BARGE_IN), None)
    agent_adapted = False
    if first_barge_index is not None:
        before = [count for idx, count in agent_word_counts if idx < first_barge_index]
        after = [count for idx, count in agent_word_counts if idx > first_barge_index]
        if before and after:
            agent_adapted = sum(after) / len(after) < sum(before) / len(before)

    substantive_texts = [
        str(turns[i].get("text", "")).split()
        for i, _, c in classifications
        if c == SUBSTANTIVE
    ]
    all_answers_short = bool(substantive_texts) and all(len(words) <= 3 for words in substantive_texts)

    if barge_in_count >= 2:
        profile = "FRUSTRATED_INTERRUPTING"
    elif backchannel_count >= 2 and barge_in_count == 0:
        profile = "ENGAGED_COOPERATIVE"
    elif callee_turns >= 3 and all_answers_short and backchannel_count == 0 and barge_in_count == 0:
        profile = "DISENGAGED"
    else:
        profile = "NEUTRAL"

    recommendation = {
        "FRUSTRATED_INTERRUPTING": ("shorten_turns", PACING_GOAL),
        "ENGAGED_COOPERATIVE": ("maintain_pacing", MAINTAIN_GUIDANCE),
        "DISENGAGED": ("pause_and_confirm", PAUSE_AND_CONFIRM_GUIDANCE),
        "NEUTRAL": ("pause_and_confirm", PAUSE_AND_CONFIRM_GUIDANCE),
    }[profile]

    card["cooperation_profile"] = profile
    card["metrics"] = {
        "callee_turns": callee_turns,
        "backchannel_count": backchannel_count,
        "barge_in_count": barge_in_count,
        "substantive_count": substantive_count,
        "backchannel_density": round(backchannel_count / callee_turns, 2),
        "avg_agent_turn_words": (
            round(sum(count for _, count in agent_word_counts) / len(agent_word_counts), 1)
            if agent_word_counts
            else 0.0
        ),
        "agent_adapted_after_barge_in": agent_adapted,
    }
    card["evidence"] = evidence
    card["pacing_recommendation"] = {
        "recommendation": recommendation[0],
        "guidance": recommendation[1],
    }
    return card


CRAFT_SCENARIOS = {"pacing-followup"}


def craft_goal(scenario: str, language: str | None = None) -> dict[str, Any]:
    """Emit plan_call inputs for a pacing-aware follow-up call."""
    if scenario not in CRAFT_SCENARIOS:
        raise ValueError(f"unknown scenario: {scenario!r}; expected one of {sorted(CRAFT_SCENARIOS)}")
    return {
        "skill": "call-semantic-barge-in-analyzer",
        "mode": "craft",
        "scenario": scenario,
        "language": language or "en",
        "goal": PACING_GOAL,
        "notes": [
            "Heuristic skill: this template is a starting point; adapt wording to the case.",
            "Keep fictional fixtures offline; any host-run live call requires separate explicit intent and an authorized E.164 destination.",
        ],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    p_analyze = sub.add_parser("analyze", help="Profile callee cooperation from a finished CALL-E call result.")
    p_analyze.add_argument("--transcript", required=True, help="Path to a CALL-E call result JSON file.")
    p_analyze.add_argument("--out", default=None, help="Write the card to this path (default: stdout).")

    p_craft = sub.add_parser("craft", help="Emit a pacing goal for the next plan_call.")
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
        payload = build_pacing_card(data["turns"])
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
