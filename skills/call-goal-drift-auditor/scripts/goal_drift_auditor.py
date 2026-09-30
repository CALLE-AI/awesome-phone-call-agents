#!/usr/bin/env python3
"""call-goal-drift-auditor - measure agent adherence to the stated call goal in CALL-E transcripts.

Twin-mode heuristic skill:
  analyze  compare the original call goal text against the finished transcript
           to detect when the agent drifted off-topic. Computes on-topic ratio,
           detects off-topic spans, and checks whether the goal was achieved.
  craft    emit a tighter goal template with explicit bounding instructions for
           the next plan_call

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
    "Heuristic text-only goal-adherence analysis. On-topic ratio is computed "
    "from keyword overlap; synonyms and paraphrases may be missed. "
    "Findings are advisory and route to human review, never to automatic action."
)

# Minimum fraction of agent turns containing a goal keyword for ON_TRACK.
ON_TRACK_THRESHOLD = 0.60

# Number of consecutive off-topic agent turns needed to flag an off-topic span.
OFF_TOPIC_SPAN_LENGTH = 2


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


# ---------------------------------------------------------------- transcript / goal loading


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
    """Load the goal text (plain text, or a JSON with a goal/task/objective field)."""
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
    raise ValueError("goal file must be plain text or a JSON object with a goal/task/objective field")


# ---------------------------------------------------------------- keyword extraction

# Stop-words to exclude from goal keyword extraction.
_STOP_WORDS = {
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "need", "dare", "ought",
    "used", "to", "of", "in", "on", "at", "for", "from", "by", "with",
    "about", "as", "into", "through", "during", "before", "after", "above",
    "below", "between", "out", "up", "and", "or", "but", "nor", "so", "yet",
    "either", "both", "not", "no", "nor", "if", "this", "that", "these",
    "those", "it", "its", "you", "your", "we", "our", "they", "their",
    "i", "my", "he", "his", "she", "her", "any", "all", "each", "every",
    "call", "calling", "caller", "please", "thank", "thanks", "hello",
    "hi", "goodbye", "bye",
}

# Confirmation/closing phrase patterns — presence signals goal achieved.
_CONFIRMATION_PATTERNS = [
    re.compile(p, re.IGNORECASE)
    for p in [
        r"\bconfirm(?:ed|ing)?\b",
        r"\bschedul(?:ed|ing)?\b",
        r"\bbooked?\b",
        r"\bverif(?:ied|y|ying)?\b",
        r"\bsuccess(?:fully)?\b",
        r"\ball set\b",
        r"\bthat(?:'s| is) done\b",
        r"\byou(?:'re| are) (?:all )?set\b",
        r"\bthat(?:'s| is) confirmed\b",
        r"\ball confirmed\b",
        r"\bgreat(?:, (?:all )?set)?\b",
    ]
]


def extract_goal_keywords(goal_text: str) -> set[str]:
    """Extract meaningful content words from a goal text as lowercase tokens."""
    tokens = re.findall(r"[a-zA-Z]+", goal_text)
    return {
        t.lower()
        for t in tokens
        if len(t) >= 4 and t.lower() not in _STOP_WORDS
    }


def _turn_is_on_topic(text: str, keywords: set[str]) -> bool:
    """True if a turn contains at least one goal keyword."""
    words = {w.lower() for w in re.findall(r"[a-zA-Z]+", text)}
    return bool(words & keywords)


def _goal_achieved_in_closing(turns: list[dict[str, str]], keywords: set[str]) -> bool:
    """Check if goal keywords appear with a confirmation phrase in the last 4 agent turns."""
    agent_turns = [
        str(t.get("text", ""))
        for t in turns
        if str(t.get("speaker", "")).lower().strip() not in CALLEE_ROLES
    ]
    closing_turns = agent_turns[-4:] if len(agent_turns) >= 4 else agent_turns
    for text in closing_turns:
        has_keyword = _turn_is_on_topic(text, keywords)
        has_confirmation = any(p.search(text) for p in _CONFIRMATION_PATTERNS)
        if has_keyword and has_confirmation:
            return True
    return False


# ---------------------------------------------------------------- craft templates

def _make_craft_goal(original_goal: str) -> str:
    return (
        f"You are making a call with a specific and bounded goal. "
        f"Your goal is: {original_goal} "
        f"Stay focused on this goal throughout the entire call. "
        f"Do not volunteer information about other topics or services "
        f"unless the contact raises them directly. "
        f"If the contact steers the conversation off-topic, acknowledge "
        f"their concern briefly and return to the primary goal. "
        f"Before ending the call, confirm explicitly that the goal has "
        f"been achieved. If the goal cannot be achieved in this call, "
        f"state clearly what step is needed next."
    )


CRAFT_SCENARIOS = {"goal-refocus"}


def craft_goal(scenario: str, goal_text: str | None = None, language: str | None = None) -> dict[str, Any]:
    """Emit plan_call inputs for a tighter, bounded goal call."""
    if scenario not in CRAFT_SCENARIOS:
        raise ValueError(f"unknown scenario: {scenario!r}; expected one of {sorted(CRAFT_SCENARIOS)}")
    if goal_text:
        goal = _make_craft_goal(goal_text)
    else:
        goal = (
            "Stay focused on your assigned goal throughout the entire call. "
            "Do not volunteer information about other topics. "
            "Before ending, confirm explicitly that the goal has been achieved."
        )
    return {
        "skill": "call-goal-drift-auditor",
        "mode": "craft",
        "scenario": scenario,
        "language": language or "en",
        "goal": goal,
        "notes": [
            "Heuristic skill: adapt the bounding instructions to the specific context.",
            "Keep fictional fixtures offline; any host-run live call requires separate explicit intent and an authorized E.164 destination.",
        ],
    }


# ---------------------------------------------------------------- analysis


def analyze_transcript(turns: list[dict[str, str]], goal_text: str) -> dict[str, Any]:
    """Build the goal-drift audit card from turns and goal text."""
    card: dict[str, Any] = {
        "skill": "call-goal-drift-auditor",
        "analysis_mode": "heuristic",
        "drift_assessment": "assessed",
        "reason": None,
        "goal_keywords": [],
        "agent_turn_count": 0,
        "on_topic_turn_count": 0,
        "on_topic_ratio": 0.0,
        "off_topic_spans": [],
        "goal_achieved": False,
        "verdict": "ON_TRACK",
        "recommended_action": {"action": "no_action_required", "guidance": None},
        "disclaimer": DISCLAIMER,
    }

    keywords = extract_goal_keywords(goal_text)
    card["goal_keywords"] = sorted(keywords)

    if not keywords:
        card["drift_assessment"] = "unclear"
        card["reason"] = "no_goal_keywords_extracted"
        card["recommended_action"] = {
            "action": "review_goal_file",
            "guidance": "The goal text is too short or contains only stop-words. Provide a more descriptive goal for meaningful drift analysis.",
        }
        return card

    if not turns:
        card["drift_assessment"] = "unclear"
        card["reason"] = "empty_transcript"
        return card

    agent_turns_indexed = [
        (i, str(t.get("text", "")).strip())
        for i, t in enumerate(turns)
        if str(t.get("speaker", "")).lower().strip() not in CALLEE_ROLES
        and str(t.get("text", "")).strip()
    ]

    if not agent_turns_indexed:
        card["drift_assessment"] = "unclear"
        card["reason"] = "no_agent_turns"
        return card

    card["agent_turn_count"] = len(agent_turns_indexed)

    # Compute on-topic flags per agent turn.
    on_topic_flags: list[bool] = [
        _turn_is_on_topic(text, keywords) for _, text in agent_turns_indexed
    ]
    on_topic_count = sum(on_topic_flags)
    card["on_topic_turn_count"] = on_topic_count
    card["on_topic_ratio"] = round(on_topic_count / len(agent_turns_indexed), 4)

    # Detect off-topic spans (consecutive off-topic turns ≥ OFF_TOPIC_SPAN_LENGTH).
    off_topic_spans: list[dict[str, Any]] = []
    span_start = None
    for pos, (turn_idx, text) in enumerate(agent_turns_indexed):
        if not on_topic_flags[pos]:
            if span_start is None:
                span_start = (pos, turn_idx)
        else:
            if span_start is not None:
                span_len = pos - span_start[0]
                if span_len >= OFF_TOPIC_SPAN_LENGTH:
                    off_topic_spans.append(
                        {
                            "start_turn_index": span_start[1],
                            "length_in_agent_turns": span_len,
                            "first_off_topic_evidence": mask_pii(
                                agent_turns_indexed[span_start[0]][1][:160]
                            ),
                        }
                    )
                span_start = None
    # Flush trailing span.
    if span_start is not None:
        span_len = len(agent_turns_indexed) - span_start[0]
        if span_len >= OFF_TOPIC_SPAN_LENGTH:
            off_topic_spans.append(
                {
                    "start_turn_index": span_start[1],
                    "length_in_agent_turns": span_len,
                    "first_off_topic_evidence": mask_pii(
                        agent_turns_indexed[span_start[0]][1][:160]
                    ),
                }
            )

    card["off_topic_spans"] = off_topic_spans
    card["goal_achieved"] = _goal_achieved_in_closing(turns, keywords)

    # Determine verdict.
    ratio = card["on_topic_ratio"]
    span_count = len(off_topic_spans)

    if not card["goal_achieved"] and ratio < ON_TRACK_THRESHOLD:
        card["verdict"] = "GOAL_NOT_ACHIEVED"
        card["recommended_action"] = {
            "action": "retry_with_tighter_goal",
            "guidance": (
                f"On-topic ratio {ratio:.1%} is below threshold ({ON_TRACK_THRESHOLD:.0%}) "
                f"and the goal does not appear achieved in the closing turns. "
                "Use craft mode to generate a tighter goal with explicit bounding instructions."
            ),
        }
    elif span_count >= 2:
        card["verdict"] = "SIGNIFICANT_DRIFT"
        card["recommended_action"] = {
            "action": "retry_with_tighter_goal",
            "guidance": (
                f"Detected {span_count} off-topic span(s) (each ≥ {OFF_TOPIC_SPAN_LENGTH} consecutive "
                "agent turns without goal keywords). The agent drifted significantly. "
                "Use craft mode to generate a tighter goal with explicit bounding instructions."
            ),
        }
    elif span_count == 1:
        card["verdict"] = "MILD_DRIFT"
        card["recommended_action"] = {
            "action": "monitor_and_consider_tighter_goal",
            "guidance": (
                "One off-topic span detected. The call largely stayed on track but had one "
                "notable digression. Consider using craft mode to add bounding instructions."
            ),
        }
    else:
        card["verdict"] = "ON_TRACK"
        card["recommended_action"] = {
            "action": "no_action_required",
            "guidance": f"Agent maintained goal focus (on-topic ratio {ratio:.1%}). No significant drift detected.",
        }

    return card


# ---------------------------------------------------------------- CLI


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    p_analyze = sub.add_parser("analyze", help="Audit goal drift in a finished CALL-E call result.")
    p_analyze.add_argument("--transcript", required=True, help="Path to a CALL-E call result JSON file.")
    p_analyze.add_argument("--goal-file", required=True, help="Path to the goal text (or plan JSON) the call was built from.")
    p_analyze.add_argument("--out", default=None, help="Write the card to this path (default: stdout).")

    p_craft = sub.add_parser("craft", help="Emit a tighter bounded goal for the next plan_call.")
    p_craft.add_argument("--scenario", required=True, help=f"One of {sorted(CRAFT_SCENARIOS)}.")
    p_craft.add_argument("--goal-file", default=None, help="Original goal text to embed in the bounding goal (optional).")
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
        payload = analyze_transcript(data["turns"], goal_text)
        if data.get("call_id"):
            payload = {"call_id": data["call_id"], **payload}
    else:
        goal_text = None
        if args.goal_file:
            gp = Path(args.goal_file)
            if not gp.is_file():
                print(f"ERROR: goal file not found: {gp}", file=sys.stderr)
                return 2
            try:
                goal_text = load_goal_file(gp)
            except (ValueError, OSError) as exc:
                print(f"ERROR: {exc}", file=sys.stderr)
                return 2
        try:
            payload = craft_goal(args.scenario, goal_text=goal_text, language=args.language)
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
