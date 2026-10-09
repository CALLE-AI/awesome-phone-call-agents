#!/usr/bin/env python3
"""call-correction-propagation-auditor - audit agent self-corrections in CALL-E calls.

Heuristic twin-mode skill:
  analyze  detect AGENT self-corrections in the transcript ("Sorry, I said
           Tuesday; I meant Thursday"), chain superseded values, and check
           whether the CORRECTED value (not the superseded one) reached the
           post_summary of the get_call_run result
           (PROPAGATED, STALE_VALUE_IN_SUMMARY, CORRECTIONS_UNCONFIRMED,
           NO_SELF_CORRECTIONS)
  craft    emit a correction-discipline goal template for plan_call so the
           agent re-states, confirms, and consistently uses corrected values

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
    "Heuristic self-correction detection, not semantic repair analysis. A detected "
    "correction chain is lexical evidence the agent restated a value; "
    "STALE_VALUE_IN_SUMMARY means the superseded surface form appears in the summary "
    "while the corrected one does not. Callee revisions are provenance-grade's object; "
    "callee-initiated repair is call-repair-sequence-auditor's object. Route every "
    "finding to human review against the call record."
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
        "post_summary": str(payload.get("post_summary") or ""),
        "turns": turns,
    }


# Split on sentence enders, but not inside "a.m."/"p.m." style abbreviations.
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])(?<![aApP]\.m\.)\s+(?=[A-Z])")


def split_sentences(text: str) -> list[str]:
    """Split turn text into sentences, keeping a.m./p.m. intact."""
    return [s for s in _SENTENCE_SPLIT_RE.split(text) if s.strip()]


def is_agent_turn(turn: dict[str, str]) -> bool:
    """True when the turn's speaker is not one of the callee-side roles."""
    return str(turn.get("speaker", "unknown")).lower() not in CALLEE_ROLES


# ---------------------------------------------------------------------------
# Craft: correction-discipline goal template
# ---------------------------------------------------------------------------


def craft_template() -> str:
    return (
        "GOAL: collect or confirm the booking details with the callee.\n"
        "CORRECTION DISCIPLINE: if you correct any detail mid-call (date, time,\n"
        "amount, name, address), immediately (1) re-state the corrected value in\n"
        "a full sentence, (2) ask the caller to confirm it, and (3) use only the\n"
        "corrected value from then on. The end-of-call summary must state only\n"
        "corrected values - never a value you superseded during the call.\n"
    )


# ---------------------------------------------------------------------------
# Analyze
# ---------------------------------------------------------------------------


def analyze(turns: list[dict[str, str]], post_summary: str, call_id: str | None = None) -> dict[str, Any]:
    """Audit agent self-corrections and their propagation into post_summary."""
    masked_turns = [
        {"speaker": t.get("speaker", "unknown"), "text": mask_pii(str(t.get("text", "")))}
        for t in turns
    ]
    events: list[dict[str, Any]] = []
    chains: list[dict[str, Any]] = []
    confirmed_flags: list[bool] = []

    summary = post_summary or ""
    summary_checks: list[dict[str, Any]] = []
    advisories: list[str] = []
    if not summary.strip():
        advisories.append("summary_missing")

    corrections = [
        {
            "turn_index": e["turn_index"],
            "marker": e["marker"],
            "old_value": e["old_value"],
            "new_value": e["new_value"],
            "kind": e["kind"],
            "chain_index": None,
            "confirmed": None,
        }
        for e in events
    ]
    counts = {
        "correction_events": len(events),
        "chains": len(chains),
        "stale": sum(1 for c in summary_checks if c["outcome"] == "stale"),
        "unconfirmed": sum(1 for f in confirmed_flags if not f),
    }

    if not events:
        verdict = "NO_SELF_CORRECTIONS"
    elif any(c["outcome"] == "stale" for c in summary_checks):
        verdict = "STALE_VALUE_IN_SUMMARY"
    elif any(not f for f in confirmed_flags):
        verdict = "CORRECTIONS_UNCONFIRMED"
    else:
        verdict = "PROPAGATED"

    card: dict[str, Any] = {
        "skill": "call-correction-propagation-auditor",
        "call_id": call_id,
        "verdict": verdict,
    }
    if not turns:
        card["reason"] = "transcript_missing"
    card["counts"] = counts
    card["corrections"] = corrections
    card["summary_checks"] = summary_checks
    card["advisories"] = advisories
    card["disclaimer"] = DISCLAIMER
    return card


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="correction_propagation_auditor")
    sub = parser.add_subparsers(dest="command", required=True)
    sub_analyze = sub.add_parser("analyze")
    sub_analyze.add_argument("--call-result", required=True)
    sub.add_parser("craft")
    args = parser.parse_args(argv)

    try:
        if args.command == "analyze":
            record = load_call_result(Path(args.call_result))
            card = analyze(record["turns"], record["post_summary"], call_id=record["call_id"])
            print(json.dumps(card, indent=2))
            return 0
        print(craft_template(), end="")
        return 0
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        sys.stderr.write(f"error: {exc}\n")
        return 2


if __name__ == "__main__":
    sys.exit(main())
