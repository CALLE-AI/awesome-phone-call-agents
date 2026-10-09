#!/usr/bin/env python3
"""call-repair-sequence-auditor - audit other-initiated repair in CALL-E transcripts.

Twin-mode heuristic skill:
  analyze  find callee-initiated repair sequences, localize the trouble-source
           agent turn, classify how the agent handled them, and rate the call
  craft    emit a repair-anticipated, chunked goal template for the next plan_call

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
    "Heuristic text-only conversation analysis. Repair detection here is a "
    "lexical approximation of conversation-analytic other-initiated repair; "
    "prosodic and timing cues are invisible in transcripts, so counts "
    "under-report rather than over-report. Verdicts advise a human, they "
    "decide nothing."
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
    payload = data.get("result") if isinstance(data.get("result", ""), dict) else data
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


# Repair-initiator lexicons, in detection order. Grounded in the CA taxonomy
# of other-initiated repair (Dingemanse et al., PLoS ONE 2015), its virtual-
# assistant replication (Galbraith, Frontiers in Robotics and AI 2024), and
# incremental clarification design for voice assistants (Addlesee and Eshghi,
# Frontiers in Dementia 2024). English-only by design.

# Full-phrase requests first so "can you repeat that" is not also matched as
# open-class "that".
_REPAIR_PATTERNS: list[tuple[str, str]] = [
    ("repetition_request", r"\b(?:can|could|would|will) you (?:please )?(?:repeat|say) (?:that|it|this|the last part)(?: again)?\b"),
    ("repetition_request", r"\bsay (?:that|it) again\b"),
    ("repetition_request", r"\b(?:once more|one more time|again please)\b"),
    ("repetition_request", r"\brepeat (?:that|it|the (?:number|date|address|part))\b"),
    ("specification_request", r"\bwhich (?:one|day|date|number|time|address|option)\b"),
    ("specification_request", r"\bcan you (?:speak|slow|go) (?:slower|more slowly)\b"),
    ("specification_request", r"\bspeak (?:up|slower|more slowly)\b"),
    ("specification_request", r"\bspell (?:that|it|the name)\b"),
    ("specification_request", r"\bwho (?:is|are) (?:this|you|calling)\b"),
    ("specification_request", r"\bwhat is this (?:about|regarding|for)\b"),
    ("candidate_understanding", r"\b(?:did|do) (?:you|I hear you) say\b"),
    ("candidate_understanding", r"(?<!what )\byou mean\b"),
    ("candidate_understanding", r"\b(?:is|was) it (?:the )?[a-z0-9'+-]+ or\b"),
    ("open_class", r"\bhuh\b"),
    ("open_class", r"\bpardon\?*\b"),
    ("open_class", r"\bcome again\b"),
    ("open_class", r"\bsorry\?+\s*$"),
    ("open_class", r"\bwhat\?+\s*$"),
    ("open_class", r"\bexcuse me\?+\s*$"),
]

_WORD_RE = re.compile(r"[a-z']+|[0-9]+", re.IGNORECASE)


def _content_words(text: str) -> list[str]:
    return [w.lower() for w in _WORD_RE.findall(text)]


def _find_partial_repeat(turn_text: str, agent_text: str) -> bool:
    """A short question turn that mostly quotes the preceding agent turn."""
    words = _content_words(turn_text)
    if not words or len(words) > 10 or not turn_text.strip().endswith("?"):
        return False
    agent_words = set(_content_words(agent_text))
    if not agent_words:
        return False
    overlap = sum(1 for w in words if w in agent_words)
    return overlap / len(words) >= 0.4


def classify_repair(turn_text: str, agent_text: str) -> str | None:
    """Return the repair type initiated by this callee turn, if any."""
    stripped = turn_text.strip()
    if not stripped:
        return None
    for name, pattern in _REPAIR_PATTERNS:
        if re.search(pattern, stripped, re.IGNORECASE):
            return name
    if _find_partial_repeat(stripped, agent_text):
        return "partial_repeat"
    return None


# Trouble-source profiling: what in the agent turn made repair likely.
_SENTENCE_SPLIT_RE = re.compile(r"[.!?]+\s")
_LONG_WORD_LEN = 12
_LONG_SENTENCE_WORDS = 25


def profile_trouble_source(agent_text: str) -> list[str]:
    profile: list[str] = []
    words = _content_words(agent_text)
    digits = sum(1 for w in words if w.isdigit())
    if digits >= 2:
        profile.append("digit_dense")
    if sum(1 for w in words if len(w) >= _LONG_WORD_LEN) >= 2:
        profile.append("long_words")
    sentences = [s for s in _SENTENCE_SPLIT_RE.split(agent_text) if s.strip()]
    if any(len(_content_words(s)) > _LONG_SENTENCE_WORDS for s in sentences):
        profile.append("long_sentence")
    return profile or ["unremarkable"]


# Resolution: does the next agent turn visibly address the repair? A turn
# addresses the repair when it uses an explicit re-delivery marker, commits
# to an option (candidate/partial repairs), restates enough of the trouble
# source (content-word overlap), or gives a short digit-bearing restatement.
_ADDRESSED_MARKERS = re.compile(
    r"\b(?:i said|let me repeat|i(?:'| a)m sorry,|sorry,|to (?:be )?clear|"
    r"in other words|that is|let me (?:rephrase|clarify|slow)|i will slow down|"
    r"more slowly|spell(?:ed|ing)?|one digit at a time|again,)\b",
    re.IGNORECASE,
)
_COMMIT_RE = re.compile(
    r"\b(?:yes|no|exactly|right|correct|not|it(?:'| i)s|that(?:'| i)s)\b",
    re.IGNORECASE,
)


def _overlap_ratio(turn_text: str, source_text: str) -> float:
    """Share of the candidate turn's content words present in the source."""
    words = _content_words(turn_text)
    if not words:
        return 0.0
    source_words = set(_content_words(source_text))
    if not source_words:
        return 0.0
    return sum(1 for w in words if w in source_words) / len(words)


def classify_resolution(next_agent_text: str, repair_type: str, trouble_source_text: str) -> str:
    """ADDRESSED, IGNORED, or END_OF_CALL for the agent turn after a repair."""
    stripped = next_agent_text.strip()
    if not stripped:
        return "END_OF_CALL"
    if _ADDRESSED_MARKERS.search(stripped):
        return "ADDRESSED"
    words = _content_words(stripped)
    if repair_type in {"candidate_understanding", "partial_repeat"} and _COMMIT_RE.search(stripped):
        return "ADDRESSED"
    if _overlap_ratio(stripped, trouble_source_text) >= 0.4:
        return "ADDRESSED"
    if repair_type in {"repetition_request", "specification_request"}:
        # A short digit-bearing turn restating the value counts even without
        # an explicit marker; a long pivot to a new topic does not.
        if re.search(r"[0-9]", stripped) and len(words) <= 6:
            return "ADDRESSED"
    if len(words) <= 3:
        return "ADDRESSED"
    return "IGNORED"


SIMPLIFIED_GOAL = (
    "You are calling back a person who had trouble following the previous "
    "call. Use short turns: one fact per sentence, at most two sentences "
    "before you pause for a reply. Say numbers one digit at a time, then "
    "ask the person to read them back. Tell the person early and plainly "
    "who is calling and what the call is about. Say explicitly at the "
    "start: if anything is unclear, please stop me and I will repeat it "
    "slowly. When the person asks you to repeat, do not restate the same "
    "long sentence - shorten it, slow it down, and repeat only the part "
    "they asked about."
)

CRAFT_SCENARIOS = {"high-trouble-redial"}


def craft_goal(scenario: str, language: str | None = None) -> dict[str, Any]:
    """Emit plan_call inputs for a repair-anticipated follow-up call."""
    if scenario not in CRAFT_SCENARIOS:
        raise ValueError(f"unknown scenario: {scenario!r}; expected one of {sorted(CRAFT_SCENARIOS)}")
    return {
        "skill": "call-repair-sequence-auditor",
        "mode": "craft",
        "scenario": scenario,
        "language": language or "en",
        "goal": SIMPLIFIED_GOAL,
        "notes": [
            "Heuristic skill: this template is a starting point; adapt wording to the case.",
            "Keep fictional fixtures offline; any host-run live call requires separate explicit intent and an authorized E.164 destination.",
        ],
    }


def _verdict_for(repairs: int, ignored: int) -> str:
    if ignored >= 2 or repairs >= 4:
        return "HIGH"
    if ignored == 1 or repairs >= 2:
        return "MODERATE"
    return "LOW"


def analyze_turns(turns: list[dict[str, str]]) -> dict[str, Any]:
    """Build the repair card from normalized turns."""
    card: dict[str, Any] = {
        "skill": "call-repair-sequence-auditor",
        "analysis_mode": "heuristic",
        "repair_assessment": "assessed",
        "reason": None,
        "comprehension_trouble": "LOW",
        "repair_events": [],
        "repairs_initiated": 0,
        "unresolved_repairs": 0,
        "dominant_trouble_type": None,
        "repair_baseline_note": (
            "Human conversation runs at roughly one repair every 1.4 minutes "
            "(Dingemanse et al. 2015, twelve-language sample). Transcripts "
            "carry no reliable offsets here, so this card reports counts per "
            "call instead of a rate; treat the baseline as illustrative only."
        ),
        "recommended_action": {"action": "continue", "guidance": None},
        "disclaimer": DISCLAIMER,
    }

    if not turns:
        card["repair_assessment"] = "unclear"
        card["reason"] = "empty_transcript"
        return card

    events: list[dict[str, Any]] = []
    trouble_types: list[str] = []
    ignored = 0
    for index, turn in enumerate(turns):
        speaker = str(turn.get("speaker", "")).lower().strip()
        text = str(turn.get("text", "")).strip()
        if speaker not in CALLEE_ROLES or not text:
            continue
        # Find the nearest preceding agent turn (the candidate trouble source).
        source_index = None
        source_text = ""
        for back in range(index - 1, -1, -1):
            prev_speaker = str(turns[back].get("speaker", "")).lower().strip()
            if prev_speaker not in CALLEE_ROLES and str(turns[back].get("text", "")).strip():
                source_index = back
                source_text = str(turns[back].get("text", "")).strip()
                break
        if source_index is None:
            continue
        repair_type = classify_repair(text, source_text)
        if repair_type is None:
            continue
        # Next non-empty agent turn after the repair decides resolution.
        # Empty agent-side turns (normalizer placeholders) are skipped, not
        # treated as end-of-call.
        resolution = "END_OF_CALL"
        for fwd in range(index + 1, len(turns)):
            next_speaker = str(turns[fwd].get("speaker", "")).lower().strip()
            if next_speaker not in CALLEE_ROLES:
                next_text = str(turns[fwd].get("text", "")).strip()
                if not next_text:
                    continue
                resolution = classify_resolution(next_text, repair_type, source_text)
                break
        profile = profile_trouble_source(source_text)
        events.append(
            {
                "repair_turn_index": index,
                "repair_type": repair_type,
                "span": mask_pii(text),
                "trouble_source_index": source_index,
                "trouble_profile": profile,
                "resolution": resolution,
            }
        )
        trouble_types.extend(profile)
        if resolution == "IGNORED":
            ignored += 1

    if not any(
        str(t.get("speaker", "")).lower().strip() in CALLEE_ROLES and str(t.get("text", "")).strip()
        for t in turns
    ):
        card["repair_assessment"] = "unclear"
        card["reason"] = "insufficient_callee_signal"
        return card

    card["repair_events"] = events
    card["repairs_initiated"] = len(events)
    card["unresolved_repairs"] = ignored
    if trouble_types:
        dominant = max(set(trouble_types), key=trouble_types.count)
        card["dominant_trouble_type"] = dominant if dominant != "unremarkable" else None
    card["comprehension_trouble"] = _verdict_for(len(events), ignored)

    if card["comprehension_trouble"] == "HIGH":
        card["recommended_action"] = {
            "action": "redial_with_simplified_goal",
            "guidance": SIMPLIFIED_GOAL,
        }
    elif ignored == 1:
        card["recommended_action"] = {
            "action": "verify_understanding_prompt",
            "guidance": (
                "One repair was left unresolved. On the next contact, open by "
                "asking the person to state back the key fact in their own "
                "words before anything else."
            ),
        }
    elif card["comprehension_trouble"] == "MODERATE":
        card["recommended_action"] = {
            "action": "continue",
            "guidance": (
                "Multiple repairs in one call, all resolved. The wording still "
                "caused trouble; consider the simplified goal wording on the "
                "next contact."
            ),
        }
    return card


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    p_analyze = sub.add_parser("analyze", help="Audit repair sequences in a finished CALL-E call result.")
    p_analyze.add_argument("--transcript", required=True, help="Path to a CALL-E call result JSON file.")
    p_analyze.add_argument("--out", default=None, help="Write the card to this path (default: stdout).")

    p_craft = sub.add_parser("craft", help="Emit a repair-anticipated goal for the next plan_call.")
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
