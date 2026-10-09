#!/usr/bin/env python3
"""call-politeness-strategy-auditor - grade agent request phrasing against politeness strategy markers.

Twin-mode heuristic skill:
  analyze  detect agent request sentences (imperatives, questions, indirect
           forms), mark which politeness strategies each carries, and grade
           each BALD vs SOFTENED, reporting COURTEOUS / MIXED /
           BALD_REQUESTS_DETECTED / NO_AGENT_REQUESTS
  craft    emit a softened-request goal template for plan_call

Runs offline, deterministic, no LLM, no network. Input errors exit 2.

Documented classification rules (deterministic, no special-casing):
- question-form requests are structurally NEVER BALD: the interrogative is
  itself an indirectness redress (Brown & Levinson: bald-on-record vs
  redressed act)
- implicit-request forms recognized as redressed: "If you would/could ...",
  "I was wondering if ...", "Would you mind ...", "Might I ask ...",
  "I'm afraid ..."
- "Say, ..." / "Tell me, ..." exclamatory openers (comma directly after the
  verb) are not imperatives; such sentences still classify as questions
  when they end with "?"
- transitional waits ("Hold on", "One moment", "Bear with me") and
  agent-self-directed sentences ("Let me check", "I'll be right back")
  are not requests
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
    "Form audit, never content: a polite request for out-of-scope data still "
    "fails call-data-minimization-auditor, and politeness grading never "
    "sanitizes what is asked. Lexical strategy markers, not a cultural or "
    "sincerity judgment. Route findings to human review."
)

# Sentence split that does not cut inside "a.m."/"p.m." (family standard)
# nor inside honorific vocatives ("Mr. Nguyen, ..."), which this skill's
# formal_address strategy depends on.
_SENTENCE_SPLIT_RE = re.compile(
    r"(?<=[.!?])(?<![aApP]\.m\.)(?<![Mm]r\.)(?<![Mm]rs\.)(?<![Mm]s\.)(?<![Dd]r\.)\s+(?=[A-Z])"
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


def split_sentences(text: str) -> list[str]:
    return [s for s in _SENTENCE_SPLIT_RE.split(text.strip()) if s.strip()]


def is_agent_turn(turn: dict[str, Any]) -> bool:
    return turn.get("speaker", "").lower() not in CALLEE_ROLES


# ---------------------------------------------------------------------------
# Request detection and strategy marking
# ---------------------------------------------------------------------------

_IMPERATIVE_RE = re.compile(
    r"^(?:please\s+|kindly\s+)?(?:give|spell|repeat|say|tell|confirm|provide|read|"
    r"write\s+down|enter|press|bring|hand|state|list)\b",
    re.IGNORECASE,
)
_HOLD_LINE_RE = re.compile(r"^(?:please\s+|kindly\s+)?hold\s+the\s+line\b", re.IGNORECASE)
# Exclamatory openers: "Say, that's great news!" - verb immediately followed
# by a comma is commentary, not a directive.
_EXCLAMATORY_RE = re.compile(r"^(?:say|tell)\s*,", re.IGNORECASE)
_TRANSITIONAL_RE = re.compile(
    r"^(?:hold\s+on|one\s+moment|just\s+a\s+moment|bear\s+with\s+me|hang\s+tight|"
    r"give\s+me\s+(?:a|one)\s+(?:second|moment))\b",
    re.IGNORECASE,
)
_SELF_DIRECTED_RE = re.compile(
    r"^(?:let\s+me|let\s+us|i'?ll|i\s+will|i'?m\s+going\s+to)\b", re.IGNORECASE
)
# Implicit request forms - all structurally redressed, never BALD.
_INDIRECT_FORM_RE = re.compile(
    r"^(?:if\s+you\s+(?:would|could)\b|i\s+was\s+wondering\s+if\b|would\s+you\s+mind\b|"
    r"might\s+i\s+ask\b|i'?m\s+afraid\b|i'?d\s+like\s+you\s+to\b|"
    r"sorry\s+to\s+(?:trouble|bother|ask)\b|forgive\s+(?:me|the)\b|my\s+apologies\b)",
    re.IGNORECASE,
)
# Vocative openers ("Mr. Nguyen, please confirm...") - stripped before the
# imperative/indirect checks; strategies are still evaluated on the full
# sentence so the formal_address marker can fire.
_VOCATIVE_RE = re.compile(
    r"^(?:sir|ma'?am|mr\.?\s+[A-Za-z]+|ms\.?\s+[A-Za-z]+|mrs\.?\s+[A-Za-z]+)\s*,?\s+",
    re.IGNORECASE,
)

_SOFTENERS: dict[str, re.Pattern[str]] = {
    "modal": re.compile(r"\b(?:could|would|can|may)\s+you\b", re.IGNORECASE),
    "please": re.compile(r"\bplease\b|\bkindly\b", re.IGNORECASE),
    "gratitude": re.compile(
        r"\bthank(?:s|\s+you)?\b|\bi\s+appreciate\b|\bappreciated\b", re.IGNORECASE
    ),
    "apologize": re.compile(
        r"\bsorry\s+to\s+(?:trouble|bother|ask)\b|\bi'?m\s+afraid\b|\bmy\s+apologies\b|"
        r"\bforgive\s+(?:me|the)\b",
        re.IGNORECASE,
    ),
    "hedge": re.compile(
        r"\bjust\b|\bmaybe\b|\bperhaps\b|\bpossibly\b|\ba\s+quick\b|\bfor\s+a\s+second\b",
        re.IGNORECASE,
    ),
    "deference": re.compile(
        r"\bif\s+you\s+(?:would|could)\b|\bwhen\s+you\s+(?:have|get)\s+a\s+(?:moment|second)\b|"
        r"\bno\s+rush\b|\bat\s+your\s+convenience\b|\bwhenever\s+works\s+for\s+you\b|\bwhenever\s+you(?:'re|\s+are)\s+ready\b",
        re.IGNORECASE,
    ),
    "counterfactual": re.compile(r"\bcould\s+you\s+possibly\b|\bwould\s+you\s+mind\b", re.IGNORECASE),
    "indirect": re.compile(r"\bi\s+was\s+wondering\s+if\b|\bmight\s+i\s+ask\s+you\s+to\b", re.IGNORECASE),
    "formal_address": re.compile(
        r"\b(?:Mr|Mrs|Ms|Dr|Sir|Madam|ma'?am)\.?\s+[A-Z][a-z]"
    ),
}
_CONDESCENSION_RE = re.compile(
    r"\b(?:dear|honey|sweetie|sugar|sonny|good\s+(?:girl|boy))\b", re.IGNORECASE
)


def classify_sentence(sentence: str) -> dict[str, Any] | None:
    """Classify one agent sentence; return a request record or None."""
    stripped = sentence.strip()
    if not stripped:
        return None
    if _TRANSITIONAL_RE.match(stripped) or _SELF_DIRECTED_RE.match(stripped):
        return None
    vocative = _VOCATIVE_RE.match(stripped)
    core = stripped[vocative.end():] if vocative else stripped
    form: str | None = None
    imperative = _IMPERATIVE_RE.match(core) or _HOLD_LINE_RE.match(core)
    if imperative and not _EXCLAMATORY_RE.match(core):
        form = "imperative"
    if core.endswith("?"):
        form = "question"
    elif _INDIRECT_FORM_RE.match(core):
        form = "question"
    if form is None:
        return None
    strategies = [name for name, rx in _SOFTENERS.items() if rx.search(stripped)]
    grade = "BALD" if form == "imperative" and not strategies else "SOFTENED"
    return {"sentence": stripped, "form": form, "strategies": strategies, "grade": grade}


def verdict_of(requests: list[dict[str, Any]], bald_count: int) -> str:
    total = len(requests)
    if total == 0:
        return "NO_AGENT_REQUESTS"
    if bald_count >= 3 or (total >= 3 and bald_count * 2 > total):
        return "BALD_REQUESTS_DETECTED"
    if bald_count >= 1:
        return "MIXED"
    return "COURTEOUS"


def analyze(
    turns: list[dict[str, Any]], post_summary: str, call_id: str | None = None
) -> dict[str, Any]:
    """Grade every agent request sentence for politeness strategies."""
    requests: list[dict[str, Any]] = []
    advisories: list[str] = []
    condescension_flags = 0
    question_requests = 0
    bald_count = 0
    for index, turn in enumerate(turns):
        masked_text = mask_pii(str(turn.get("text", "")))
        if not is_agent_turn(turn):
            continue
        if _CONDESCENSION_RE.search(masked_text):
            condescension_flags += 1
            advisories.append(f"condescension_turn: {index}")
        for sentence in split_sentences(masked_text):
            record = classify_sentence(sentence)
            if record is None:
                continue
            record["turn_index"] = index
            requests.append(record)
            if record["form"] == "question":
                question_requests += 1
            if record["grade"] == "BALD":
                bald_count += 1
    card = {
        "skill": "call-politeness-strategy-auditor",
        "call_id": call_id,
        "verdict": verdict_of(requests, bald_count),
        "counts": {
            "requests": len(requests),
            "bald": bald_count,
            "question_requests": question_requests,
            "condescension_flags": condescension_flags,
        },
        "requests": requests,
        "advisories": advisories,
        "post_summary_present": bool(mask_pii(post_summary).strip()),
        "disclaimer": DISCLAIMER,
    }
    return card


# ---------------------------------------------------------------------------
# Craft: softened-request goal template
# ---------------------------------------------------------------------------

def craft_template() -> str:
    return (
        "GOAL: collect the required details from the callee.\n"
        "REQUEST DISCIPLINE: make every request with a modal (\"Could you...\"), attach\n"
        "\"please\" where natural, thank the caller after each compliance, and apologize\n"
        "once for the interruption at the start. Never use bare imperatives (\"Give me\n"
        "...\") - softened requests get the same data with less friction.\n"
    )


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="politeness_strategy_auditor")
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
