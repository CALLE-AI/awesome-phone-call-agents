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

Limitations: proximity resolution picks the nearest preceding same-kind
value; disjunctive lists ("Tuesday or Wednesday") may bind the wrong
superseded value.
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

# Real CALL-E transcription emits typographic apostrophes and quotes; the
# lexicons in this file are written with ASCII quotes. Normalize one-char-
# to-one-char (offset-preserving) before any matching, mirroring the
# convention in skills/verify-by-phone/scripts/extract_answer.py.
_TYPOGRAPHIC = str.maketrans(
    {
        "\u2018": "'",
        "\u2019": "'",
        "\u201c": '"',
        "\u201d": '"',
    }
)


def normalize_input(text: str) -> str:
    return text.translate(_TYPOGRAPHIC)


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
# Value extraction and canonical folding
# ---------------------------------------------------------------------------

_MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december"
_MONTH_DAY_RE = re.compile(
    rf"\b({_MONTHS})\s+([0-9]{{1,2}})(?:st|nd|rd|th)?\b"
    rf"|\b(?:the\s+)?([0-9]{{1,2}})(?:st|nd|rd|th)\s+of\s+({_MONTHS})\b"
    rf"|\b([0-9]{{1,2}})(?:st|nd|rd|th)?\s+({_MONTHS})\b", re.IGNORECASE)
_SLASH_DATE_RE = re.compile(r"\b([0-9]{1,2})/([0-9]{1,2})\b")
_WEEKDAY_RE = re.compile(r"\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?![a-z'])", re.IGNORECASE)
_CLOCK_RE = re.compile(r"\b(?:at\s+)?([0-9]{1,2})(?::([0-9]{2}))?\s*(a\.?m\.?|p\.?m\.?)?\b(?![0-9])", re.IGNORECASE)
_MONEY_RE = re.compile(r"[$]([0-9][0-9 ,.]*[0-9]|[0-9])\b|\b([0-9][0-9 ,.]*[0-9]|[0-9])\s+(?:dollars|usd)\b", re.IGNORECASE)
_COUNT_RE = re.compile(r"\b([0-9][0-9 ,]*[0-9]|[0-9])\s+(?:guests?|people|persons?|minutes?|hours?|days?|seats?|items?|pills?|tablets?|refills?|bags?|boxes?)\b", re.IGNORECASE)
_STREET_RE = re.compile(r"\b([0-9]{1,5})\s+(?:[A-Z][a-z]+\s+)?(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct)\b")

_MONTH_ABBRS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
# Full names first so "october" is not half-matched by its abbreviation.
_MONTH_TOKEN = "|".join(sorted(_MONTHS.split("|") + _MONTH_ABBRS, key=len, reverse=True))
_MONTH_DAY_ALL_RE = re.compile(
    rf"\b({_MONTH_TOKEN})\s+([0-9]{{1,2}})(?:st|nd|rd|th)?\b"
    rf"|\b(?:the\s+)?([0-9]{{1,2}})(?:st|nd|rd|th)\s+of\s+({_MONTH_TOKEN})\b"
    rf"|\b([0-9]{{1,2}})(?:st|nd|rd|th)?\s+({_MONTH_TOKEN})\b",
    re.IGNORECASE,
)


def _clock_value(hour: str, minute: str | None, meridiem: str | None) -> str:
    """Canonical 24h clock string: "2 p.m." and "14:00" both become "14:00"."""
    h = int(hour)
    mm = minute or "00"
    if meridiem:
        mer = re.sub(r"\.", "", meridiem).lower()
        if mer.startswith("p") and h != 12:
            h += 12
        elif mer.startswith("a") and h == 12:
            h = 0
    return f"{h:02d}:{mm}"


def _canon_date(m: re.Match[str]) -> str:
    month = (m.group(1) or m.group(4) or m.group(6))[:3].lower()
    day = str(int(m.group(2) or m.group(3) or m.group(5)))
    return f"{month}-{day}"


def _slash_canon(m: re.Match[str]) -> str:
    month_n, day_n = int(m.group(1)), int(m.group(2))
    if 1 <= month_n <= 12 and 1 <= day_n <= 31:
        return f"{_MONTH_ABBRS[month_n - 1]}-{day_n}"
    return m.group(0)


def _clock_canon(m: re.Match[str]) -> str:
    # Bare hour with neither minutes nor meridiem is not a clock ("party of 4").
    if not (m.group(2) or m.group(3)):
        return m.group(0)
    return _clock_value(m.group(1), m.group(2), m.group(3))


def _money_canon(m: re.Match[str]) -> str:
    num = m.group(1) or m.group(2)
    return "$" + re.sub(r"[ ,.]", "", num)


def fold_text(text: str) -> str:
    """Lowercase and canonicalize dates/clocks/money to searchable tokens."""
    folded = text.lower()
    for full in _MONTHS.split("|"):
        folded = re.sub(rf"\b{full}\b", full[:3], folded)
    folded = _MONTH_DAY_ALL_RE.sub(_canon_date, folded)
    folded = _SLASH_DATE_RE.sub(_slash_canon, folded)
    folded = _CLOCK_RE.sub(_clock_canon, folded)
    folded = _MONEY_RE.sub(_money_canon, folded)
    return folded


def extract_values(text: str) -> list[dict[str, Any]]:
    """Extract checkable values (date/weekday/clock/money/count/street) from text."""
    values: list[dict[str, Any]] = []
    for m in _MONTH_DAY_ALL_RE.finditer(text):
        values.append({"kind": "date", "value": _canon_date(m), "raw": m.group(0), "start": m.start()})
    for m in _SLASH_DATE_RE.finditer(text):
        canon = _slash_canon(m)
        if canon != m.group(0):
            values.append({"kind": "date", "value": canon, "raw": m.group(0), "start": m.start()})
    for m in _WEEKDAY_RE.finditer(text):
        values.append({"kind": "weekday", "value": m.group(0).lower(), "raw": m.group(0), "start": m.start()})
    for m in _CLOCK_RE.finditer(text):
        if not (m.group(2) or m.group(3)):
            continue
        values.append({"kind": "clock", "value": _clock_value(m.group(1), m.group(2), m.group(3)), "raw": m.group(0), "start": m.start()})
    for m in _MONEY_RE.finditer(text):
        values.append({"kind": "money", "value": _money_canon(m), "raw": m.group(0), "start": m.start()})
    for m in _COUNT_RE.finditer(text):
        values.append({"kind": "count", "value": re.sub(r"[ ,]", "", m.group(1)), "raw": m.group(0), "start": m.start()})
    for m in _STREET_RE.finditer(text):
        values.append({"kind": "street", "value": m.group(0).lower(), "raw": m.group(0), "start": m.start()})
    # Masked PII runs (with "#") never become correction values.
    values = [v for v in values if "#" not in v["raw"]]
    values.sort(key=lambda v: v["start"])
    return values


# ---------------------------------------------------------------------------
# Self-correction detection
# ---------------------------------------------------------------------------

_MARKERS = [
    ("not_x_but_y", re.compile(r"\bnot\s+(?P<old>[^,.;!?]{1,40}?)\s*,?\s*(?:but\s+(?:it'?s\s+)?|it'?s\s+|\u2014|-)\s*", re.IGNORECASE)),
    ("y_not_x", re.compile(r"\b(?:it'?s|that'?s|i\s+meant)\s+(?P<new>[^,.;!?]{1,40}?)\s+not\s+(?P<old>[^,.;!?]{1,40})", re.IGNORECASE)),
    ("sorry_i_said", re.compile(r"\bsorry[,.]?\s+i\s+said\b|\bi\s+missaid\b", re.IGNORECASE)),
    ("meant", re.compile(r"\bi\s+meant\b(?!\s+(?:that|to\s+say\s+that)\b)", re.IGNORECASE)),
    ("correction", re.compile(r"\bcorrection\s*[:,-]?\s*", re.IGNORECASE)),
    ("let_me_correct", re.compile(r"\blet\s+me\s+correct\s+that\s*[:,-]?\s*", re.IGNORECASE)),
    ("incorrect", re.compile(r"\b(?:that'?s|that\s+is)\s+incorrect[,.]?\s*(?:it'?s\s+)?", re.IGNORECASE)),
    ("should_be", re.compile(r"\b(?:that|it)\s+should\s+be\s+", re.IGNORECASE)),
    ("my_mistake", re.compile(r"\bmy\s+mistake\b|\bi\s+(?:have\s+)?misspok(?:e|en)\b|\bmy\s+apologies[,.]?\s*it'?s\s+", re.IGNORECASE)),
    ("actually_its", re.compile(r"\bactually[,.]?\s+(?:(?:it|that)'?s|the\s+[a-z]+\s+is)\s+", re.IGNORECASE)),
    ("scratch", re.compile(r"\bscratch\s+(?:that|the)\b", re.IGNORECASE)),
]

_ACK_RE = re.compile(
    r"\b(?:ok(?:ay)?|sure|alright|absolutely|yes|yep|yeah|"
    r"that'?s (?:right|correct)|correct|that works|works for me|"
    r"sounds good|perfect|exactly|great)\b",
    re.IGNORECASE,
)


def _sentence_spans(text: str) -> list[tuple[str, int, int]]:
    spans = []
    pos = 0
    for sent in _SENTENCE_SPLIT_RE.split(text):
        idx = text.find(sent, pos)
        if idx < 0:
            continue
        spans.append((sent, idx, idx + len(sent)))
        pos = idx + len(sent)
    return spans


def _first_value_after(values: list[dict[str, Any]], abs_pos: int) -> dict[str, Any] | None:
    for v in values:
        if v["start"] >= abs_pos:
            return v
    return None


def _proximity_value(
    turn_values: list[dict[str, Any]],
    turns: list[dict[str, str]],
    turn_index: int,
    before_abs: int,
    kind: str,
    exclude: str,
) -> dict[str, Any] | None:
    """Last same-kind value before the marker: same turn first, then the
    immediately preceding agent turn; values equal to the new one are skipped."""
    candidates = [
        v for v in turn_values
        if v["start"] < before_abs and v["kind"] == kind and v["value"] != exclude
    ]
    if candidates:
        return candidates[-1]
    for j in range(turn_index - 1, -1, -1):
        if not is_agent_turn(turns[j]):
            continue
        prior = [
            v for v in extract_values(str(turns[j].get("text", "")))
            if v["kind"] == kind and v["value"] != exclude
        ]
        if prior:
            return prior[-1]
        break
    return None


def _bare_number_value(text: str, new: dict[str, Any]) -> dict[str, Any] | None:
    """Same-kind value for a lone number old-group ("it's 2 guests not 4")."""
    mm = re.match(r"^\s*\$?\s*([0-9][0-9 ,]*[0-9]|[0-9])\s*$", text, re.IGNORECASE)
    if not mm:
        return None
    digits = re.sub(r"[ ,]", "", mm.group(1))
    if new["kind"] == "count":
        return {"kind": "count", "value": digits, "raw": text.strip(), "start": 0}
    if new["kind"] == "money":
        return {"kind": "money", "value": "$" + digits, "raw": text.strip(), "start": 0}
    return None


def _build_event(
    name: str,
    m: re.Match[str],
    sent: str,
    sent_start: int,
    sent_end: int,
    turn_text: str,
    turn_values: list[dict[str, Any]],
    turn_index: int,
    turns: list[dict[str, str]],
) -> dict[str, Any] | None:
    old: dict[str, Any] | None = None
    new: dict[str, Any] | None = None

    if name == "not_x_but_y":
        old_vals = extract_values(m.group("old"))
        old = old_vals[0] if old_vals else None
        new = _first_value_after(turn_values, sent_start + m.end())
    elif name == "y_not_x":
        new_vals = extract_values(m.group("new"))
        new = new_vals[0] if new_vals else None
        old_vals = extract_values(m.group("old"))
        if old_vals:
            old = old_vals[0]
        elif new is not None:
            old = _bare_number_value(m.group("old"), new)
    elif name == "sorry_i_said":
        meant_m = next(rx for n, rx in _MARKERS if n == "meant").search(sent)
        if meant_m is None:
            old = _first_value_after(turn_values, sent_start + m.end())
            if old is not None:
                new = _proximity_value(turn_values, turns, turn_index, sent_start + m.start(), old["kind"], old["value"])
        else:
            new = _first_value_after(turn_values, sent_start + meant_m.end())
            if new is not None:
                # Old candidates live between the marker and "meant"; a
                # candidate identical to the new value ("I missaid the date;
                # I meant Thursday") means the real old value must come from
                # proximity instead.
                region_end = sent_start + meant_m.start()
                old = next(
                    (v for v in turn_values
                     if sent_start + m.end() <= v["start"] < region_end
                     and v["kind"] == new["kind"] and v["value"] != new["value"]),
                    None,
                )
                if old is None:
                    old = _proximity_value(turn_values, turns, turn_index, sent_start + m.start(), new["kind"], new["value"])
    elif name == "scratch":
        # A value in the marker sentence ("Scratch the Tuesday part") is the
        # value being REMOVED (old); the new value must come later in the turn.
        # With no in-sentence value ("Scratch that"), the marker stays pending
        # and the new value is the first one after the marker.
        in_sentence = [
            v for v in turn_values
            if sent_start + m.end() <= v["start"] < sent_end
        ]
        if in_sentence:
            old = in_sentence[0]
            new = _first_value_after(turn_values, sent_end)
            if new is None:
                # No replacement value exists; cannot determine it
                # deterministically, so no event fires (conservative).
                return None
        else:
            new = _first_value_after(turn_values, sent_start + m.end())
    else:  # meant alone / correction / let_me_correct / incorrect / should_be / my_mistake / actually_its
        new = _first_value_after(turn_values, sent_start + m.end())

    if new is None:
        return None
    if old is None and name not in ("not_x_but_y", "y_not_x"):
        old = _proximity_value(turn_values, turns, turn_index, sent_start + m.start(), new["kind"], new["value"])
    if name in ("not_x_but_y", "y_not_x") and (old is None or new is None):
        return None
    return {
        "turn_index": turn_index,
        "marker": name,
        "old_value": old["value"] if old else None,
        "new_value": new["value"],
        "kind": new["kind"],
        "start": m.start(),
    }


def detect_corrections(turns: list[dict[str, str]]) -> list[dict[str, Any]]:
    """Detect agent self-correction events from masked transcript turns."""
    events: list[dict[str, Any]] = []
    for ti, turn in enumerate(turns):
        if not is_agent_turn(turn):
            continue
        text = str(turn.get("text", ""))
        if not text.strip():
            continue
        turn_values = extract_values(text)
        for sent, s_start, s_end in _sentence_spans(text):
            if sent.strip().endswith("?"):
                continue
            for name, rx in _MARKERS:
                m = rx.search(sent)
                if not m:
                    continue
                event = _build_event(name, m, sent, s_start, s_end, text, turn_values, ti, turns)
                if event:
                    events.append(event)
                break  # first matching marker wins the sentence
    return events


# ---------------------------------------------------------------------------
# Chains, propagation, confirmation
# ---------------------------------------------------------------------------


def build_chains(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Chain events whose old_value supersedes a chain's final or superseded value."""
    chains: list[dict[str, Any]] = []
    for idx, ev in sorted(enumerate(events), key=lambda p: (p[1]["turn_index"], p[1]["start"])):
        target = None
        for ch in chains:
            if ev["old_value"] is not None and (
                ev["old_value"] == ch["final"] or ev["old_value"] in ch["superseded"]
            ):
                target = ch
                break
        if target is not None:
            target["superseded"].append(ev["old_value"])
            target["final"] = ev["new_value"]
            target["kind"] = ev["kind"]
            target["event_indices"].append(idx)
        else:
            chains.append({
                "final": ev["new_value"],
                "superseded": [ev["old_value"]] if ev["old_value"] else [],
                "kind": ev["kind"],
                "event_indices": [idx],
            })
    return chains


def _value_pattern(kind: str, value: str) -> str:
    esc = re.escape(value).replace(r"\ ", r"\s+")
    if kind == "clock":
        return rf"(?<![0-9:]){esc}(?![0-9:])"
    if kind == "weekday":
        # "Tuesday's" is a different token: no match after ' or a letter.
        return rf"\b{esc}(?![a-z'])"
    return rf"(?<![0-9]){esc}(?![0-9])"


def check_propagation(chains: list[dict[str, Any]], post_summary: str) -> list[dict[str, Any]]:
    """Check each chain's final (and superseded) values against the folded summary."""
    folded = fold_text(mask_pii(normalize_input(post_summary or "")))
    checks = []
    for i, ch in enumerate(chains):
        final_in = re.search(_value_pattern(ch["kind"], ch["final"]), folded) is not None
        stale_vals = [
            v for v in ch["superseded"]
            if re.search(_value_pattern(ch["kind"], v), folded)
        ]
        if stale_vals and not final_in:
            outcome = "stale"
        elif stale_vals and final_in:
            outcome = "ambiguous"
        elif final_in:
            outcome = "propagated"
        else:
            outcome = "unreported"
        checks.append({
            "chain_index": i,
            "final_value": ch["final"],
            "final_in_summary": final_in,
            "stale_values_in_summary": stale_vals,
            "outcome": outcome,
        })
    return checks


def chain_confirmed(
    chain: dict[str, Any],
    turns: list[dict[str, str]],
    correction_turn_index: int,
) -> bool:
    """A chain is confirmed by a later agent restate or a near-window callee ack."""
    final_re = re.compile(_value_pattern(chain["kind"], chain["final"]))
    for j in range(correction_turn_index + 1, len(turns)):
        if is_agent_turn(turns[j]) and final_re.search(fold_text(str(turns[j].get("text", "")))):
            return True
    for j in (correction_turn_index + 1, correction_turn_index + 2):
        if j >= len(turns) or is_agent_turn(turns[j]):
            continue
        text = str(turns[j].get("text", ""))
        if final_re.search(fold_text(text)) or _ACK_RE.search(text):
            return True
    return False


# ---------------------------------------------------------------------------
# Analyze
# ---------------------------------------------------------------------------


def analyze(turns: list[dict[str, str]], post_summary: str, call_id: str | None = None) -> dict[str, Any]:
    """Audit agent self-corrections and their propagation into post_summary."""
    masked_turns = [
        {
            "speaker": t.get("speaker", "unknown"),
            "text": mask_pii(normalize_input(str(t.get("text", "")))),
        }
        for t in turns
    ]
    events = detect_corrections(masked_turns)
    chains = build_chains(events)

    confirmed_flags = []
    for ch in chains:
        last_event = events[ch["event_indices"][-1]]
        confirmed_flags.append(chain_confirmed(ch, masked_turns, last_event["turn_index"]))

    summary = post_summary or ""
    summary_checks: list[dict[str, Any]] = []
    advisories: list[str] = []
    if not summary.strip():
        advisories.append("summary_missing")
    else:
        summary_checks = check_propagation(chains, summary)
        for c in summary_checks:
            if c["outcome"] == "unreported":
                advisories.append(f"unreported_chain: {c['final_value']}")

    chain_of_event: dict[int, int] = {}
    for ci, ch in enumerate(chains):
        for ei in ch["event_indices"]:
            chain_of_event[ei] = ci
    corrections = [
        {
            "turn_index": ev["turn_index"],
            "marker": ev["marker"],
            "old_value": ev["old_value"],
            "new_value": ev["new_value"],
            "kind": ev["kind"],
            "chain_index": chain_of_event.get(ei),
            "confirmed": confirmed_flags[chain_of_event[ei]] if ei in chain_of_event else None,
        }
        for ei, ev in enumerate(events)
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
