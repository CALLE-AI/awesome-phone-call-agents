#!/usr/bin/env python3
"""call-post-summary-faithfulness-auditor - audit post_summary text against the transcript.

Twin-mode heuristic skill:
  analyze  decompose the agent-written post_summary into atomic claims,
           anchor each claim to transcript evidence, and grade every claim
           SUPPORTED / UNSUPPORTED / CONTRADICTED, then report an overall
           verdict (FAITHFUL, UNSUPPORTED_CLAIMS, CONTRADICTED_CLAIMS,
           NO_CHECKABLE_CLAIMS)
  craft    emit a faithful-summary goal template for plan_call so the agent
           only restates what was spoken aloud

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
    "Heuristic lexical anchoring, not semantic entailment. UNSUPPORTED "
    "means the claim value was not found verbatim in any transcript turn; "
    "it is not proof the claim is false. CONTRADICTED flags conflict with "
    "late callee speech under a fixed polarity rule. Route every finding "
    "to human verification against the call record."
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


# ---------------------------------------------------------------------------
# Claim decomposition
# ---------------------------------------------------------------------------

# Split on sentence enders, but not inside "a.m."/"p.m." style abbreviations.
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z])")

_MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december"
_MONTH_DAY_RE = re.compile(
    rf"\b({_MONTHS})\s+([0-9]{{1,2}})(?:st|nd|rd|th)?\b"
    rf"|\b(?:the\s+)?([0-9]{{1,2}})(?:st|nd|rd|th)\s+of\s+({_MONTHS})\b",
    re.IGNORECASE,
)
_WEEKDAY_RE = re.compile(r"\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b", re.IGNORECASE)
_CLOCK_RE = re.compile(r"\b(?:at\s+)?([0-9]{1,2})(?::([0-9]{2}))?\s*(a\.?m\.?|p\.?m\.?)\b", re.IGNORECASE)
_OUTCOME_RE = re.compile(
    r"\b(?:confirm(?:ed|s)?|cancel(?:led|s)?|declin(?:ed|es)?|reschedul(?:ed|es)?|"
    r"accept(?:ed|s)?|book(?:ed|s)?|no.?answer|voicemail|call(?:ed|s)? back)\b",
    re.IGNORECASE,
)
_ACTION_RE = re.compile(
    r"\b(?:will\s+(?:send|email|call\s+back|confirm|arrange|mail)|"
    r"has\s+been\s+booked|will\s+be\s+(?:emailed|sent|mailed))\b",
    re.IGNORECASE,
)
# "party of N" is a prefix pattern: the digit FOLLOWS the phrase, so it is
# matched as its own alternative rather than a unit suffix.
_NUM_CONTEXT_RE = re.compile(
    r"[$]([0-9][0-9 ,./-]*[0-9]|[0-9])\b"
    r"|\bparty\s+of\s+([0-9][0-9 ,./-]*[0-9]|[0-9])\b"
    r"|\b([0-9][0-9 ,./-]*[0-9]|[0-9])\s+"
    r"(?:dollars|usd|guests?|people|minutes?|hours?|days?|seats?|items?|percent|%)\b",
    re.IGNORECASE,
)
_SPELLED_RE = re.compile(
    r"\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b",
    re.IGNORECASE,
)

# Outcome polarity: positive stems assert the booking/outcome holds, negative
# stems assert it does not. "call back" is a neutral follow-up, treated as
# positive for anchoring purposes.
_OUTCOME_POLARITY = {
    "confirm": "positive",
    "accept": "positive",
    "book": "positive",
    "reschedule": "positive",
    "call back": "positive",
    "cancel": "negative",
    "decline": "negative",
    "no-answer": "negative",
    "voicemail": "negative",
}


def _outcome_stem(matched: str) -> str:
    word = matched.strip().lower()
    if word.startswith("cancel"):
        return "cancel"
    if word.startswith("declin"):
        return "decline"
    if word.startswith("reschedul"):
        return "reschedule"
    if word.startswith("confirm"):
        return "confirm"
    if word.startswith("accept"):
        return "accept"
    if word.startswith("book"):
        return "book"
    if word.startswith("call"):
        return "call back"
    if "answer" in word:
        return "no-answer"
    if "voicemail" in word:
        return "voicemail"
    return word


# Action claims anchor to a root verb, matched with a word-boundary prefix so
# that "email" matches "email"/"emailed" but NOT the "mail" inside "email".
_ACTION_ROOTS = ("send", "email", "mail", "call back", "confirm", "arrange", "book")


def _action_root(matched: str) -> str:
    phrase = matched.strip().lower()
    # Strip passive/aux wrappers and common past-tense suffixes to a root.
    phrase = re.sub(r"^(?:will\s+be\s+|will\s+|has\s+been\s+)", "", phrase)
    phrase = re.sub(r"(?:ed|s)$", "", phrase)
    for root in sorted(_ACTION_ROOTS, key=len, reverse=True):
        if phrase.startswith(root) or phrase.endswith(root):
            return root
    return phrase.split()[0] if phrase.split() else phrase


def _digits_only(text: str) -> str:
    return re.sub(r"[^0-9]", "", text)


def _claim(sentence: str, kind: str, value: str, **extra: Any) -> dict[str, Any]:
    claim = {"text": sentence.strip(), "kind": kind, "value": value}
    claim.update(extra)
    return claim


def decompose_claims(masked_summary: str) -> list[dict[str, Any]]:
    """Decompose a (already PII-masked) post_summary into atomic claims."""
    claims: list[dict[str, Any]] = []
    for sentence in _SENTENCE_SPLIT_RE.split(masked_summary.strip()):
        if not sentence.strip():
            continue
        found = False

        outcome_m = _OUTCOME_RE.search(sentence)
        if outcome_m:
            stem = _outcome_stem(outcome_m.group(0))
            claims.append(_claim(sentence, "outcome", stem, direction=_OUTCOME_POLARITY.get(stem, "positive")))
            found = True

        num_m = _NUM_CONTEXT_RE.search(sentence)
        if num_m:
            raw = next(g for g in num_m.groups() if g is not None)
            claims.append(_claim(sentence, "numeric", _digits_only(raw)))
            found = True

        date_m = _MONTH_DAY_RE.search(sentence)
        if date_m:
            month = (date_m.group(1) or date_m.group(4))[:3].lower()
            day = date_m.group(2) or date_m.group(3)
            claims.append(_claim(sentence, "date_time", f"{month} {day}"))
            found = True

        weekday_m = _WEEKDAY_RE.search(sentence)
        if weekday_m:
            claims.append(_claim(sentence, "date_time", weekday_m.group(0).lower()))
            found = True

        clock_m = _CLOCK_RE.search(sentence)
        if clock_m:
            meridiem = re.sub(r"\.", "", clock_m.group(3)).lower()
            minute = clock_m.group(2)
            value = clock_m.group(1) + (f":{minute}" if minute else "") + meridiem
            claims.append(_claim(sentence, "date_time", value))
            found = True

        action_m = _ACTION_RE.search(sentence)
        if action_m:
            claims.append(_claim(sentence, "action", _action_root(action_m.group(0))))
            found = True

        # Spelled word numbers are noted even next to a checkable kind: they
        # themselves are not machine-checkable against the transcript.
        spelled_m = _SPELLED_RE.search(sentence)
        if spelled_m:
            claims.append(_claim(sentence, "non_checkable_spelled", spelled_m.group(0).lower()))
            found = True

        if not found:
            claims.append(_claim(sentence, "non_checkable_opinion", ""))
    return claims


# ---------------------------------------------------------------------------
# Anchoring + verdict engine
# ---------------------------------------------------------------------------

_MONTH_FOLD = {m[:3]: m for m in _MONTHS.split("|")}


def fold_turn(text: str) -> str:
    """Normalize turn text for lexical anchoring (case, meridiem, months)."""
    folded = mask_pii(text).casefold()
    # "2 p.m." -> "2pm" so summary and transcript folds align.
    folded = re.sub(r"([0-9])\s*(a|p)\.?m\.?", r"\1\2m", folded)
    # Fold full month names to their 3-letter form ("october 14" -> "oct 14").
    for short, full in _MONTH_FOLD.items():
        folded = re.sub(rf"\b{full}\b", short, folded)
    # Strip commas inside digit runs ("1,200" -> "1200").
    folded = re.sub(r"([0-9]),([0-9])", r"\1\2", folded)
    return folded


_NEG_RE = re.compile(r"\b(?:can'?t make it|cancel|decline|not coming|no[,.]?\s*(?:thanks|thank you))\b", re.IGNORECASE)
_POS_OUTCOME_RE = re.compile(
    r"\b(?:confirm\w*|accept\w*|book\w*|reschedul\w*|call(?:ed|s)?\s+back)\b", re.IGNORECASE
)
_ACK_RE = re.compile(r"\b(?:okay|ok|sounds good|will do|alright|sure)\b", re.IGNORECASE)
_CHECKABLE_KINDS = {"outcome", "numeric", "date_time", "action"}


def _final_third_start(turn_count: int) -> int:
    return turn_count * 2 // 3


def anchor_claims(claims: list[dict[str, Any]], turns: list[dict[str, str]]) -> list[dict[str, Any]]:
    """Grade each claim SUPPORTED / UNSUPPORTED / CONTRADICTED against turns."""
    folded = [fold_turn(t.get("text", "")) for t in turns]
    speakers = [str(t.get("speaker", "unknown")).lower() for t in turns]
    late_callee = [
        folded[i] for i in range(_final_third_start(len(turns)), len(turns))
        if speakers[i] in CALLEE_ROLES
    ]

    results: list[dict[str, Any]] = []
    for claim in claims:
        kind = claim["kind"]
        value = claim["value"]
        grade, turn_index = "NON_CHECKABLE", None

        if kind == "numeric":
            hit = next((i for i, f in enumerate(folded)
                        if re.search(rf"(?<![0-9]){re.escape(value)}(?![0-9])", f)), None)
            grade, turn_index = ("SUPPORTED", hit) if hit is not None else ("UNSUPPORTED", None)
        elif kind == "date_time":
            hit = next((i for i, f in enumerate(folded) if value in f), None)
            grade, turn_index = ("SUPPORTED", hit) if hit is not None else ("UNSUPPORTED", None)
        elif kind == "outcome":
            stem_pattern = "\\b" + re.escape(value).replace(" ", "\\s+") + "\\w*"
            stem_re = re.compile(stem_pattern, re.IGNORECASE)
            if claim.get("direction") == "positive" and any(_NEG_RE.search(f) for f in late_callee):
                grade = "CONTRADICTED"
            elif claim.get("direction") == "negative" and late_callee and not any(
                _NEG_RE.search(f) for f in late_callee
            ) and any(_POS_OUTCOME_RE.search(f) for f in late_callee):
                grade = "CONTRADICTED"
            else:
                hit = next((i for i, f in enumerate(folded) if stem_re.search(f)), None)
                grade, turn_index = ("SUPPORTED", hit) if hit is not None else ("UNSUPPORTED", None)
        elif kind == "action":
            root_pattern = "\\b" + re.escape(value).replace(" ", "\\s+") + "\\w*"
            root_re = re.compile(root_pattern, re.IGNORECASE)
            hit = next((i for i, f in enumerate(folded)
                        if root_re.search(f) or _ACK_RE.search(f)), None)
            grade, turn_index = ("SUPPORTED", hit) if hit is not None else ("UNSUPPORTED", None)

        results.append({
            "text": claim["text"],
            "kind": kind,
            "value": value,
            "grade": grade,
            "turn_index": turn_index,
        })
    return results


def analyze(turns: list[dict[str, str]], post_summary: str, call_id: str | None = None) -> dict[str, Any]:
    """Audit a post_summary against masked transcript turns."""
    summary_masked = mask_pii(post_summary or "")
    claims = decompose_claims(summary_masked)
    masked_turns = [{"speaker": t.get("speaker", "unknown"), "text": mask_pii(t.get("text", ""))}
                    for t in turns]
    evidence = anchor_claims(claims, masked_turns)

    checkable = [e for e in evidence if e["kind"] in _CHECKABLE_KINDS]
    counts = {
        "checkable": len(checkable),
        "supported": sum(1 for e in checkable if e["grade"] == "SUPPORTED"),
        "unsupported": sum(1 for e in checkable if e["grade"] == "UNSUPPORTED"),
        "contradicted": sum(1 for e in checkable if e["grade"] == "CONTRADICTED"),
    }

    if counts["contradicted"] >= 1:
        verdict = "CONTRADICTED_CLAIMS"
    elif counts["unsupported"] >= 1:
        verdict = "UNSUPPORTED_CLAIMS"
    elif counts["checkable"] >= 1:
        verdict = "FAITHFUL"
    else:
        verdict = "NO_CHECKABLE_CLAIMS"

    card: dict[str, Any] = {"call_id": call_id, "verdict": verdict}
    if verdict == "NO_CHECKABLE_CLAIMS":
        card["reason"] = "summary_missing" if not (post_summary or "").strip() else "opinion_only"
    card["claims"] = evidence
    card["counts"] = counts

    summary_has_outcome = any(c["kind"] == "outcome" for c in claims)
    transcript_has_outcome = any(_OUTCOME_RE.search(fold_turn(t["text"])) for t in turns)
    card["coverage_gaps"] = [] if summary_has_outcome or not transcript_has_outcome else ["outcome"]
    card["disclaimer"] = DISCLAIMER
    return card


# ---------------------------------------------------------------------------
# Craft: faithful-summary goal template
# ---------------------------------------------------------------------------

def craft_template(task: str, facts: str, outcome_token: str | None) -> str:
    token = outcome_token.strip() if outcome_token and outcome_token.strip() else "one of CONFIRMED/CANCELLED/DECLINED"
    return (
        f"GOAL: {task}. FACTS: {facts}.\n"
        "SUMMARY DISCIPLINE: end the call by restating ONLY what was spoken aloud\n"
        "- repeat numbers exactly as digit words (four, not 4-5)\n"
        "- never introduce a value, date, name, or promise the other party did not say\n"
        f"- state the outcome word ({token}) exactly once in the final summary\n"
    )


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="post_summary_faithfulness_auditor")
    sub = parser.add_subparsers(dest="command", required=True)
    sub_analyze = sub.add_parser("analyze")
    sub_analyze.add_argument("--call-result", required=True)
    sub_craft = sub.add_parser("craft")
    sub_craft.add_argument("--task", required=True)
    sub_craft.add_argument("--facts", required=True)
    sub_craft.add_argument("--outcome-token", default=None)
    args = parser.parse_args(argv)

    try:
        if args.command == "analyze":
            record = load_call_result(Path(args.call_result))
            card = analyze(record["turns"], record["post_summary"], call_id=record["call_id"])
            print(json.dumps(card, indent=2))
            return 0
        print(craft_template(args.task, args.facts, args.outcome_token), end="")
        return 0
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        sys.stderr.write(f"error: {exc}\n")
        return 2


if __name__ == "__main__":
    sys.exit(main())
