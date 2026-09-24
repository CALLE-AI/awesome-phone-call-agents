#!/usr/bin/env python3
"""call-agent-commitment-tracker - extract and classify agent commitments from CALL-E transcripts.

Twin-mode heuristic skill:
  analyze  scan AGENT turns for Commissive Speech Acts (future-action promises)
           and classify them by deadline presence: WITH_DEADLINE, WITHOUT_DEADLINE,
           CONDITIONAL. Emit a commitment card with masked evidence.
  craft    emit a commitment-followup goal template for the next plan_call

Runs offline, deterministic, no LLM, no network. Input errors exit 2.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

# Roles that belong to the other party (not the organization's agent).
CALLEE_ROLES = {"callee", "customer", "patient", "caller", "recipient", "user"}

DISCLAIMER = (
    "Heuristic text-only analysis of agent turns. A detected commitment may "
    "be a conversational courtesy rather than a binding obligation; a missed "
    "commitment may use phrasing outside the lexicon. Findings route to "
    "follow-up verification, never to automatic action."
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


# ---------------------------------------------------------------- commitment detection lexicon

# Core commitment verb phrases — future tense / intentional future.
# We match the key trigger patterns; surrounding context narrows classification.
_COMMITMENT_PATTERNS = [
    re.compile(p, re.IGNORECASE)
    for p in [
        # Primary modal futures
        r"\bI(?:'ll| will)\b",
        r"\bwe(?:'ll| will)\b",
        r"\bsomeone will\b",
        r"\ba colleague will\b",
        r"\bour team will\b",
        r"\bI(?:'m| am) going to\b",
        r"\bwe(?:'re| are) going to\b",
        # Explicit promise / commitment markers
        r"\bI promise\b",
        r"\bI commit\b",
        r"\bI guarantee\b",
        # Arrangement / scheduling language
        r"\bI(?:'ll| will) arrange\b",
        r"\bI(?:'ll| will) schedule\b",
        r"\bI(?:'ll| will) set (?:that |this )?up\b",
        r"\bI(?:'ll| will) book\b",
        # Delegation patterns
        r"\bI(?:'ll| will) have (?:someone|a colleague|our team)\b",
        r"\bI(?:'ll| will) ask (?:someone|a colleague|our team)\b",
        r"\bI(?:'ll| will) escalate\b",
        r"\bI(?:'ll| will) pass (?:this|that) (?:on|along|to)\b",
    ]
]

# Deadline / time-window markers — presence → WITH_DEADLINE.
_DEADLINE_PATTERNS = [
    re.compile(p, re.IGNORECASE)
    for p in [
        r"\bwithin\b",
        r"\bby (?:end of|close of|the end of)\b",
        r"\bby (?:today|tomorrow|monday|tuesday|wednesday|thursday|friday)\b",
        r"\bby [0-9]{1,2}(?::[0-9]{2})? ?(?:a\.?m\.?|p\.?m\.?)\b",
        r"\b(?:today|tonight|this morning|this afternoon|this evening)\b",
        r"\bin the next [0-9]+ (?:minute|hour|day|business day)s?\b",
        r"\b(?:within|in) [0-9]+ (?:minute|hour|day|business day)s?\b",
        r"\bshortly\b",
        r"\bimmediately\b",
        r"\bright (?:away|now|after)\b",
        r"\bas soon as (?:possible|we can|I can)\b",
        r"\bASAP\b",
        r"\bno later than\b",
        r"\bbefore (?:end of day|close of business|COB|EOD)\b",
    ]
]

# Conditionality — presence → CONDITIONAL (overrides deadline check).
_CONDITION_PATTERNS = [
    re.compile(p, re.IGNORECASE)
    for p in [
        r"\bif (?:you|that|this|it|we)\b",
        r"\bonce (?:you|that|this|it|we)\b",
        r"\bprovided (?:that|you)\b",
        r"\bpending\b",
        r"\bsubject to\b",
        r"\bassuming\b",
        r"\bdepending on\b",
    ]
]

# Sentence splitter — avoids cutting on "a.m." / "p.m." abbreviations.
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z])")


def _classify_commitment(sentence: str) -> str:
    """Return WITH_DEADLINE | CONDITIONAL | WITHOUT_DEADLINE for a sentence."""
    if any(p.search(sentence) for p in _CONDITION_PATTERNS):
        return "CONDITIONAL"
    if any(p.search(sentence) for p in _DEADLINE_PATTERNS):
        return "WITH_DEADLINE"
    return "WITHOUT_DEADLINE"


def _has_commitment(sentence: str) -> bool:
    return any(p.search(sentence) for p in _COMMITMENT_PATTERNS)


# ---------------------------------------------------------------- craft templates

_CRAFT_GOAL = (
    "You are following up on a previous call to verify whether commitments "
    "made by our organization have been carried out. Open by introducing "
    "yourself as an automated assistant and referencing the prior call. "
    "Ask the contact to confirm: (1) whether they received what was promised "
    "(e.g., a callback, an email, a document, an action), and (2) whether "
    "the timeline was met. Listen carefully. If the commitment was not "
    "fulfilled, acknowledge the gap without placing blame, and note that a "
    "human colleague will follow up to resolve it. Do not make new "
    "commitments during this call. End politely whether or not the "
    "commitment was confirmed."
)

CRAFT_SCENARIOS = {"commitment-followup"}


def craft_goal(scenario: str, language: str | None = None) -> dict[str, Any]:
    """Emit plan_call inputs for a commitment-followup outbound call."""
    if scenario not in CRAFT_SCENARIOS:
        raise ValueError(f"unknown scenario: {scenario!r}; expected one of {sorted(CRAFT_SCENARIOS)}")
    return {
        "skill": "call-agent-commitment-tracker",
        "mode": "craft",
        "scenario": scenario,
        "language": language or "en",
        "goal": _CRAFT_GOAL,
        "notes": [
            "Heuristic skill: adapt the goal text to the specific unfulfilled commitment.",
            "Keep fictional fixtures offline; any host-run live call requires separate explicit intent and an authorized E.164 destination.",
        ],
    }


# ---------------------------------------------------------------- analysis


def analyze_transcript(turns: list[dict[str, str]]) -> dict[str, Any]:
    """Build the commitment card from transcript turns."""
    card: dict[str, Any] = {
        "skill": "call-agent-commitment-tracker",
        "analysis_mode": "heuristic",
        "commitment_assessment": "assessed",
        "reason": None,
        "commitments": [],
        "commitment_count": {"WITH_DEADLINE": 0, "WITHOUT_DEADLINE": 0, "CONDITIONAL": 0},
        "verdict": "NONE_FOUND",
        "recommended_action": {"action": "no_followup_required", "guidance": None},
        "disclaimer": DISCLAIMER,
    }

    if not turns:
        card["commitment_assessment"] = "unclear"
        card["reason"] = "empty_transcript"
        return card

    agent_turns = [
        (i, str(t.get("text", "")).strip())
        for i, t in enumerate(turns)
        if str(t.get("speaker", "")).lower().strip() not in CALLEE_ROLES
        and str(t.get("text", "")).strip()
    ]

    if not agent_turns:
        card["commitment_assessment"] = "unclear"
        card["reason"] = "no_agent_turns"
        return card

    commitments: list[dict[str, Any]] = []
    for turn_index, text in agent_turns:
        for sentence in _SENTENCE_SPLIT_RE.split(text):
            sentence = sentence.strip()
            if not sentence:
                continue
            if not _has_commitment(sentence):
                continue
            classification = _classify_commitment(sentence)
            commitments.append(
                {
                    "turn_index": turn_index,
                    "classification": classification,
                    "evidence": mask_pii(sentence[:200]),
                }
            )

    card["commitments"] = commitments
    counts = {"WITH_DEADLINE": 0, "WITHOUT_DEADLINE": 0, "CONDITIONAL": 0}
    for c in commitments:
        counts[c["classification"]] += 1
    card["commitment_count"] = counts

    if commitments:
        card["verdict"] = "COMMITMENTS_FOUND"
        card["recommended_action"] = {
            "action": "schedule_followup_call",
            "guidance": (
                f"Found {len(commitments)} agent commitment(s): "
                f"{counts['WITH_DEADLINE']} with a deadline, "
                f"{counts['WITHOUT_DEADLINE']} without a deadline, "
                f"{counts['CONDITIONAL']} conditional. "
                "Use the craft mode to generate a follow-up call goal to verify fulfillment."
            ),
        }
    else:
        card["recommended_action"] = {
            "action": "no_followup_required",
            "guidance": "No agent commitments detected. No follow-up call required for commitment tracking.",
        }

    return card


# ---------------------------------------------------------------- CLI


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    p_analyze = sub.add_parser("analyze", help="Extract agent commitments from a finished CALL-E call result.")
    p_analyze.add_argument("--transcript", required=True, help="Path to a CALL-E call result JSON file.")
    p_analyze.add_argument("--out", default=None, help="Write the card to this path (default: stdout).")

    p_craft = sub.add_parser("craft", help="Emit a commitment-followup goal for the next plan_call.")
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
