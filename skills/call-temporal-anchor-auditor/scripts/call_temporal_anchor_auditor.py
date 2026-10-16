#!/usr/bin/env python3
"""call-temporal-anchor-auditor - audit agent temporal references for anchoring.

Twin-mode heuristic skill:
  analyze  collect temporal expressions from AGENT turns and grade whether
           committed times are anchored absolutely (calendar date + clock
           time + meridiem) or left relative/ambiguous ("next Tuesday",
           "tomorrow evening", "at 2"); detect internal date/clock conflicts
  craft    emit an absolute-time goal template for plan_call

Runs offline, deterministic, no LLM, no network. Input errors exit 2.
"""

from __future__ import annotations

import argparse
import calendar
import json
import re
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

CALLEE_ROLES = {"callee", "customer", "patient", "caller", "recipient"}

DISCLAIMER = (
    "Heuristic temporal-lexicon analysis. AMBIGUOUS flags are advisory; "
    "relative expressions need the call timestamp to resolve, and a missing "
    "anchor is not proof the callee misheard anything. Findings route to "
    "verification against the record."
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
    """Load a CALL-E call result (wrapped shape) and normalize its transcript."""
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


def load_transcript_list(path: Path) -> dict[str, Any]:
    """Load a bare JSON array of {speaker, text} turns."""
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError(f"transcript must be a JSON array, got {type(data).__name__}")
    turns = [
        {"speaker": str(item.get("speaker", "unknown")), "text": str(item.get("text", ""))}
        for item in data
        if isinstance(item, dict)
    ]
    return {"call_id": None, "status": None, "turns": turns}


def parse_called_at(text: str) -> datetime:
    """Parse an ISO-8601 timestamp; raise ValueError when invalid."""
    normalized = text.strip()
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise ValueError(f"invalid ISO-8601 called-at timestamp: {text!r}") from exc


# Temporal lexicons (spec-locked; additions allowed, weakenings are not).
_MONTHS = {"january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6, "july": 7,
           "august": 8, "september": 9, "october": 10, "november": 11, "december": 12}
_MONTH_ABBRS = {num: name[:3] for name, num in _MONTHS.items()}
_WEEKDAY_NAMES = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]

_MONTH_NAME_ALT = (
    r"jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|"
    r"sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?"
)
_MONTH_DAY_RE = re.compile(
    r"\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|"
    r"sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+([0-9]{1,2})(?:st|nd|rd|th)?\b|"
    r"\bthe\s+([0-9]{1,2})(?:st|nd|rd|th)\s+of\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|"
    r"jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b",
    re.IGNORECASE,
)
_SLASH_DATE_RE = re.compile(r"\b([0-9]{1,2})/([0-9]{1,2})\b")
_WEEKDAY_RE = re.compile(r"\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b", re.IGNORECASE)
# Connectives allowed between an adjacent weekday and date ("Wednesday or the 14th of October").
_DATE_CONNECTIVE_RE = re.compile(r"\b(?:or|the|of)\b", re.IGNORECASE)
_NEXT_THIS_WEEKDAY_RE = re.compile(
    r"\b(next|this)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b", re.IGNORECASE
)
_CLOCK_RE = re.compile(r"\b(?:at\s+)?([0-9]{1,2})(?::([0-9]{2}))?\s*(a\.?m\.?|p\.?m\.?)?\b")
_BARE_DAY_RE = re.compile(r"\bthe\s+([0-9]{1,2})(?:st|nd|rd|th)\b(?!\s+of\b)", re.IGNORECASE)
_ORDINAL_PRECEDENCE_RE = re.compile(
    r"\b(?:first|second|third|fourth|last|every)\s+$", re.IGNORECASE
)
_BAND_RE = re.compile(
    r"\b(?:in the (?:morning|afternoon|evening)|at noon|at midnight|tomorrow (?:morning|afternoon|evening))\b",
    re.IGNORECASE,
)
_RELATIVE_DAYS_RE = re.compile(
    r"\b(?:(?:(?:a|one|two|[0-9]+)\s+)?(?:day|week)s?\s+from\s+today|"
    r"today|tonight|tomorrow|day after tomorrow|this weekend|next weekend|"
    r"this week|next week|next month|in (?:a |one |two |[0-9]+ )?(?:day|week)s?)\b",
    re.IGNORECASE,
)
_COMMITMENT_RE = re.compile(
    r"\b(?:confirm|reserv|book|see you|expect you|hold|schedul|appointment|pickup|delivery|arriv)\w*\b",
    re.IGNORECASE,
)

# Classes that carry a concrete anchored meaning once resolved.
_DATE_ANCHOR_CLASSES = {"absolute_date", "relative_resolved", "relative_derived"}
_AMBIGUOUS_CLASSES = {
    "ambiguous",
    "band",
    "clock_ambiguous",
    "invalid_date",
    "unresolvable_without_call_time",
}


_MONTH_ABBR_TO_NUM = {name[:3]: num for name, num in _MONTHS.items()}
_MONTH_ABBR_TO_NUM["sept"] = 9


def _month_num(token: str) -> int:
    key = re.sub(r"[^a-z]", "", token.lower())
    if key in _MONTHS:
        return _MONTHS[key]
    return _MONTH_ABBR_TO_NUM.get(key[:3], 0)


def _canonical_date(month: int, day: int) -> str:
    return f"{_MONTH_ABBRS[month]} {day:02d}".replace(" 0", " ")


def _resolve_month_day(month: int, day: int, called_at: datetime | None) -> str | None:
    """Resolve a month-day to an ISO date using the called-at year (None when invalid)."""
    if not (1 <= month <= 12 and 1 <= day <= 31):
        return None
    if called_at is None:
        return None
    try:
        return datetime(called_at.year, month, day).date().isoformat()
    except ValueError:
        return None


def _next_weekday_date(today, weekday_index: int):
    """Next strictly-future occurrence of a weekday (exclusive of today)."""
    days_ahead = (weekday_index - today.weekday()) % 7
    if days_ahead == 0:
        days_ahead = 7
    return (today + timedelta(days=days_ahead)).isoformat()


def _next_month_date(today) -> str:
    """Same day next month, clamped to the target month's end."""
    year, month = (today.year + 1, 1) if today.month == 12 else (today.year, today.month + 1)
    day = today.day
    while day > 28:
        try:
            return datetime(year, month, day).date().isoformat()
        except ValueError:
            day -= 1
    return datetime(year, month, day).date().isoformat()


def _parse_quantity(text: str | None) -> int:
    qty_text = (text or "1").strip()
    qty = {"a": 1, "one": 1, "two": 2}.get(qty_text, None)
    return qty if qty is not None else int(qty_text)


def _resolve_relative_phrase(phrase: str, called_at: datetime) -> str | None:
    """Deterministic resolution for resolvable relative phrases; None otherwise."""
    low = phrase.lower()
    today = called_at.date()
    if low in ("today", "tonight"):
        return today.isoformat()
    if low == "tomorrow":
        return (today + timedelta(days=1)).isoformat()
    if low == "day after tomorrow":
        return (today + timedelta(days=2)).isoformat()
    m = re.fullmatch(r"(?:(a|one|two|[0-9]+)\s+)?(day|week)s?\s+from\s+today", low)
    if m:
        qty = _parse_quantity(m.group(1))
        days = qty if m.group(2) == "day" else qty * 7
        return (today + timedelta(days=days)).isoformat()
    m = re.fullmatch(r"in (a |one |two |[0-9]+ )?(day|week)s?", low)
    if m:
        qty = _parse_quantity(m.group(1))
        days = qty if m.group(2) == "day" else qty * 7
        return (today + timedelta(days=days)).isoformat()
    if low == "next month":
        return _next_month_date(today)
    return None


def _make_expr(turn_index: int, text: str, cls: str, **extra: Any) -> dict[str, Any]:
    expr: dict[str, Any] = {"turn_index": turn_index, "text": text, "class": cls}
    expr.update(extra)
    return expr


def _collect_clock(text: str, turn_index: int) -> list[dict[str, Any]]:
    exprs: list[dict[str, Any]] = []
    for m in _CLOCK_RE.finditer(text):
        hour_text, minute_text, meridiem_text = m.group(1), m.group(2), m.group(3)
        matched = m.group(0)
        has_at = bool(re.match(r"\s*at\b", matched, re.IGNORECASE))
        if not meridiem_text and not minute_text:
            # Only "at H" counts as a (ambiguous) clock reference; bare
            # numbers (day-of-month, quantities) are not clock times.
            if not has_at:
                continue
            exprs.append(_make_expr(turn_index, matched.strip(), "clock_ambiguous", value=hour_text))
            continue
        hour = int(hour_text)
        minute = int(minute_text) if minute_text else 0
        if minute > 59 or hour > 23:
            continue
        if meridiem_text:
            is_pm = "p" in meridiem_text.lower()
            if hour > 12:
                continue
            if is_pm and hour != 12:
                hour += 12
            if not is_pm and hour == 12:
                hour = 0
            exprs.append(_make_expr(turn_index, matched.strip(), "clock_absolute", value=f"{hour:02d}:{minute:02d}"))
        elif hour <= 12:
            # A colon time at or below 12 with no meridiem is 12-hour
            # ambiguous ("2:30" could be morning or afternoon); 13-23 is a
            # true 24-hour clock and stays absolute.
            exprs.append(
                _make_expr(
                    turn_index,
                    matched.strip(),
                    "clock_ambiguous",
                    value=hour_text,
                    reason="12-hour clock without meridiem",
                )
            )
        else:
            exprs.append(_make_expr(turn_index, matched.strip(), "clock_absolute", value=f"{hour:02d}:{minute:02d}"))
    return exprs


def collect_expressions(
    turns: list[dict[str, Any]], called_at: datetime | None
) -> tuple[list[dict[str, Any]], int]:
    """Collect temporal expressions from AGENT turns; count callee mentions.

    Returns (expressions, callee_time_mentions). Expressions carry
    {turn_index, text, class, value?, reason?, resolved_date?}.
    """
    expressions: list[dict[str, Any]] = []
    callee_mentions = 0
    for index, turn in enumerate(turns):
        text = mask_pii(str(turn.get("text", "")))
        role = str(turn.get("speaker", "")).lower().strip()
        if role in CALLEE_ROLES:
            callee_mentions += _count_time_mentions(text)
            continue
        if not text.strip():
            continue
        expressions.extend(_collect_agent_turn(text, index, called_at))
    return expressions, callee_mentions


def _count_time_mentions(text: str) -> int:
    """Count distinct (non-overlapping) temporal mentions in a text."""
    spans: list[tuple[int, int]] = []
    for pattern in (_MONTH_DAY_RE, _SLASH_DATE_RE, _NEXT_THIS_WEEKDAY_RE, _WEEKDAY_RE, _BAND_RE, _RELATIVE_DAYS_RE):
        spans.extend((m.start(), m.end()) for m in pattern.finditer(text))
    for m in _CLOCK_RE.finditer(text):
        matched = m.group(0)
        has_at = bool(re.match(r"\s*at\b", matched, re.IGNORECASE))
        if m.group(2) or m.group(3) or has_at:
            spans.append((m.start(), m.end()))
    merged: list[tuple[int, int]] = []
    for start, end in sorted(spans):
        if merged and start < merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return len(merged)


def _collect_agent_turn(text: str, turn_index: int, called_at: datetime | None) -> list[dict[str, Any]]:
    exprs: list[dict[str, Any]] = []

    # Calendar dates first: month-day (both word orders), MM/DD slash dates,
    # and bare ordinal days ("the 14th") whose month is inferred from the
    # call timestamp.
    date_spans: list[tuple[int, int, int | None, int]] = []  # (start, end, month, day)
    for m in _MONTH_DAY_RE.finditer(text):
        if m.group(1):
            month, day, start, end = _month_num(m.group(1)), int(m.group(2)), m.start(), m.end()
        else:
            month, day, start, end = _month_num(m.group(4)), int(m.group(3)), m.start(), m.end()
        if not (1 <= month <= 12 and 1 <= day <= 31):
            continue
        date_spans.append((start, end, month, day))
    for m in _SLASH_DATE_RE.finditer(text):
        # US MM/DD assumption; a documented limitation (10/14 -> oct 14).
        month, day = int(m.group(1)), int(m.group(2))
        if 1 <= month <= 12 and 1 <= day <= 31:
            date_spans.append((m.start(), m.end(), month, day))
    for m in _BARE_DAY_RE.finditer(text):
        date_spans.append((m.start(), m.end(), None, int(m.group(1))))
    for start, end, month, day in date_spans:
        if month is None:
            # Bare day-of-month: the month can only be inferred from the
            # call timestamp, and impossible days must not silently anchor.
            if called_at is None:
                exprs.append(_make_expr(turn_index, text[start:end], "unresolvable_without_call_time"))
                continue
            if day < 1 or day > calendar.monthrange(called_at.year, called_at.month)[1]:
                exprs.append(
                    _make_expr(
                        turn_index,
                        text[start:end],
                        "invalid_date",
                        reason=f"date does not exist in {called_at.year}",
                    )
                )
                continue
            resolved = f"{called_at.year:04d}-{called_at.month:02d}-{day:02d}"
            exprs.append(
                _make_expr(
                    turn_index,
                    text[start:end],
                    "absolute_date",
                    value=_canonical_date(called_at.month, day),
                    resolved_date=resolved,
                )
            )
            continue
        resolved = _resolve_month_day(month, day, called_at)
        if resolved:
            exprs.append(
                _make_expr(
                    turn_index,
                    text[start:end],
                    "absolute_date",
                    value=_canonical_date(month, day),
                    resolved_date=resolved,
                )
            )
        elif called_at is not None:
            # With a call timestamp, a non-resolving month-day is an
            # impossible calendar date (e.g. February 29 in 2026).
            exprs.append(
                _make_expr(
                    turn_index,
                    text[start:end],
                    "invalid_date",
                    reason=f"date does not exist in {called_at.year}",
                )
            )
        else:
            exprs.append(_make_expr(turn_index, text[start:end], "absolute_date", value=_canonical_date(month, day)))

    # "next/this <weekday>" is dialect-dependent: flagged, never guessed.
    next_this_spans = [(m.start(), m.end()) for m in _NEXT_THIS_WEEKDAY_RE.finditer(text)]
    for start, end in next_this_spans:
        exprs.append(_make_expr(turn_index, text[start:end], "ambiguous", reason="dialect-dependent"))

    # Bare weekdays: absorbed when they open a compound anchor such as
    # "Wednesday, October 14"; otherwise resolved to the nearest strictly
    # future occurrence (or flagged unresolvable without a call timestamp).
    for m in _WEEKDAY_RE.finditer(text):
        start, end = m.start(), m.end()
        if any(ns <= start and end <= ne for ns, ne in next_this_spans):
            continue
        absorbed = any(
            0 <= ds - end <= 4 and text[end:ds].strip() in (",", "", "-", "the")
            for ds, de, _, _ in date_spans
        )
        if absorbed:
            continue
        # "first Friday", "every Tuesday", "last Monday" and friends are
        # ordinal/recursive constructions; resolving the weekday alone would
        # guess a date the speaker never stated.
        if _ORDINAL_PRECEDENCE_RE.search(text[max(0, start - 15):start]):
            exprs.append(
                _make_expr(
                    turn_index,
                    m.group(0),
                    "ambiguous",
                    reason="complex ordinal weekday expression",
                )
            )
            continue
        name = m.group(0).lower()
        weekday_index = _WEEKDAY_NAMES.index(name)
        if called_at is None:
            exprs.append(_make_expr(turn_index, m.group(0), "unresolvable_without_call_time"))
        else:
            exprs.append(
                _make_expr(
                    turn_index,
                    m.group(0),
                    "relative_derived",
                    value=_next_weekday_date(called_at.date(), weekday_index),
                )
            )

    # Day-part bands are vague on their own ("tomorrow evening" has no clock).
    for m in _BAND_RE.finditer(text):
        exprs.append(_make_expr(turn_index, m.group(0), "band"))

    # Relative day/week/month phrases: resolved when the call timestamp exists.
    for m in _RELATIVE_DAYS_RE.finditer(text):
        phrase = m.group(0)
        if called_at is None:
            exprs.append(_make_expr(turn_index, phrase, "unresolvable_without_call_time"))
            continue
        resolved = _resolve_relative_phrase(phrase, called_at)
        if resolved is None:
            exprs.append(
                _make_expr(
                    turn_index,
                    phrase,
                    "ambiguous",
                    reason="week-range reference without a concrete day",
                )
            )
        else:
            exprs.append(_make_expr(turn_index, phrase, "relative_resolved", value=resolved))

    exprs.extend(_collect_clock(text, turn_index))
    return exprs


def _weekday_date_gap(
    text: str, wd_span: tuple[int, int], date_span: tuple[int, int]
) -> int | None:
    """Gap length when a weekday mention is close enough to pair with a date.

    Close enough means the intervening text is at most 20 characters and
    contains nothing but commas, whitespace, and the connectives or/the/of.
    Otherwise None. This keeps multi-slot sentences ("Wednesday, October 14
    or Friday, October 16") from pairing every weekday with every date.
    """
    start = min(wd_span[1], date_span[1])
    end = max(wd_span[0], date_span[0])
    gap = text[start:end]
    if len(gap) > 20:
        return None
    if _DATE_CONNECTIVE_RE.sub("", gap).strip(" ,") == "":
        return len(gap)
    return None


def find_conflicts(
    turns: list[dict[str, Any]],
    expressions: list[dict[str, Any]],
    called_at: datetime | None,
) -> tuple[list[dict[str, Any]], list[str]]:
    """Detect internal date/clock conflicts in agent turns.

    Pair checks need a calendar year, so without --called-at they are
    skipped and a note explains that.
    """
    notes: list[str] = []
    if called_at is None:
        notes.append(
            "date-weekday pair checks skipped: no --called-at timestamp, so "
            "stated dates have no reference year"
        )
        return [], notes

    agent_texts: dict[int, str] = {}
    for index, turn in enumerate(turns):
        role = str(turn.get("speaker", "")).lower().strip()
        if role in CALLEE_ROLES:
            continue
        text = mask_pii(str(turn.get("text", "")))
        if text.strip():
            agent_texts[index] = text

    conflicts: list[dict[str, Any]] = []
    # (a) weekday+date pair in the same turn vs the calendar of the call year,
    #     with proximity pairing so a weekday is only checked against a date it
    #     is actually adjacent to.
    # (b) same date stated with different weekdays across turns.
    weekdays_by_date: dict[str, set[tuple[int, str]]] = {}
    for index, text in agent_texts.items():
        weekday_spans = [(m.group(0).lower(), m.span()) for m in _WEEKDAY_RE.finditer(text)]
        date_matches: list[tuple[str, tuple[int, int]]] = []
        for m in _MONTH_DAY_RE.finditer(text):
            month = _month_num(m.group(1) or m.group(4))
            day = int(m.group(2) or m.group(3))
            resolved = _resolve_month_day(month, day, called_at)
            if resolved:
                date_matches.append((resolved, m.span()))
        for m in _SLASH_DATE_RE.finditer(text):
            resolved = _resolve_month_day(int(m.group(1)), int(m.group(2)), called_at)
            if resolved:
                date_matches.append((resolved, m.span()))
        adjacent: list[tuple[int, str, str]] = []
        for resolved, date_span in date_matches:
            for wd, wd_span in weekday_spans:
                gap_len = _weekday_date_gap(text, wd_span, date_span)
                if gap_len is not None:
                    adjacent.append((gap_len, wd, resolved))
        # Proximity pairing: a weekday conflicts only with its nearest
        # adjacent date, not with every date in the turn.
        nearest: dict[str, int] = {}
        for gap_len, wd, _ in adjacent:
            nearest[wd] = min(nearest.get(wd, gap_len), gap_len)
        for gap_len, wd, resolved in adjacent:
            if gap_len != nearest[wd]:
                continue
            actual = _WEEKDAY_NAMES[datetime.fromisoformat(resolved).weekday()]
            if wd != actual:
                conflicts.append(
                    {
                        "type": "INTERNAL_DATE_CONFLICT",
                        "turn_index": index,
                        "stated_weekday": wd,
                        "date": resolved,
                        "actual_weekday": actual,
                        "text": mask_pii(text)[:160],
                    }
                )
            weekdays_by_date.setdefault(resolved, set()).add((index, wd))
    for date_value, pairs in weekdays_by_date.items():
        stated = sorted({wd for _, wd in pairs})
        turn_positions = {turn for turn, _ in pairs}
        # Cross-turn only: a same-turn weekday disagreement for one date is
        # already covered by (a)'s proximity-checked pairs.
        if len(stated) > 1 and len(turn_positions) > 1:
            conflicts.append(
                {
                    "type": "INTERNAL_DATE_CONFLICT",
                    "turn_index": None,
                    "stated_weekdays": stated,
                    "date": date_value,
                    "text": None,
                }
            )

    # (c) same 12-hour clock number restated with a different value/meridiem.
    values_by_hour12: dict[int, set[str]] = {}
    for expr in expressions:
        if expr["class"] != "clock_absolute":
            continue
        hour, minute = (int(part) for part in str(expr["value"]).split(":"))
        values_by_hour12.setdefault(hour % 12, set()).add(str(expr["value"]))
    for hour12, values in values_by_hour12.items():
        if len(values) > 1:
            conflicts.append(
                {
                    "type": "INTERNAL_CLOCK_CONFLICT",
                    "turn_index": None,
                    "hour": hour12,
                    "values": sorted(values),
                    "text": None,
                }
            )
    return conflicts, notes


def commitment_findings(
    turns: list[dict[str, Any]], expressions: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Flag commitment turns whose time references never reach a full anchor.

    A FULL anchor is (an absolute or resolvable date anywhere in the call)
    plus a clock_absolute time for it. Turns matching _COMMITMENT_RE that
    carry time expressions but only relative/ambiguous/vague ones get a
    RELATIVE_ONLY_COMMITMENT finding.
    """
    if not expressions:
        return []
    by_turn: dict[int, list[dict[str, Any]]] = {}
    for expr in expressions:
        by_turn.setdefault(expr["turn_index"], []).append(expr)
    has_date_anchor = any(e["class"] in _DATE_ANCHOR_CLASSES for e in expressions)
    has_clock = any(e["class"] == "clock_absolute" for e in expressions)
    call_fully_anchored = has_date_anchor and has_clock

    findings: list[dict[str, Any]] = []
    for index, turn in enumerate(turns):
        role = str(turn.get("speaker", "")).lower().strip()
        if role in CALLEE_ROLES:
            continue
        text = mask_pii(str(turn.get("text", "")))
        if not text.strip():
            continue
        if not _COMMITMENT_RE.search(text):
            continue
        turn_exprs = by_turn.get(index, [])
        if not turn_exprs:
            # Commitment without any time reference of its own: out of
            # scope (findings require a carried or linked time expression).
            continue
        turn_has_clock = any(e["class"] == "clock_absolute" for e in turn_exprs)
        turn_has_date = any(e["class"] in _DATE_ANCHOR_CLASSES for e in turn_exprs)
        if turn_has_clock and (turn_has_date or call_fully_anchored):
            continue
        if call_fully_anchored:
            # The slot is anchored elsewhere in the call; this restatement
            # may lean on it, so no finding.
            continue
        worst = next(
            (e for e in turn_exprs if e["class"] in _AMBIGUOUS_CLASSES),
            turn_exprs[0],
        )
        findings.append(
            {
                "turn_index": index,
                "expression": worst["text"],
                "type": "RELATIVE_ONLY_COMMITMENT",
                "suggested": "weekday, month day, at H p.m.",
            }
        )
    return findings


def _verdict(
    expressions: list[dict[str, Any]],
    conflicts: list[dict[str, Any]],
    findings: list[dict[str, Any]],
) -> str:
    if not expressions:
        return "NO_TIME_REFERENCES"
    if conflicts:
        return "INTERNAL_DATE_CONFLICT"
    if findings:
        return "RELATIVE_ONLY_COMMITMENTS"
    if any(e["class"] in _AMBIGUOUS_CLASSES for e in expressions):
        return "AMBIGUOUS_TIME_REFERENCES"
    return "FULLY_ANCHORED"


def analyze_call(
    turns: list[dict[str, Any]], called_at: datetime | None, called_at_raw: str | None
) -> dict[str, Any]:
    """Build the temporal anchoring card from normalized turns."""
    expressions, callee_mentions = collect_expressions(turns, called_at)
    conflicts, notes = find_conflicts(turns, expressions, called_at)
    findings = commitment_findings(turns, expressions)
    counts: dict[str, int] = {}
    for expr in expressions:
        counts[expr["class"]] = counts.get(expr["class"], 0) + 1
    return {
        "verdict": _verdict(expressions, conflicts, findings),
        "called_at_echo": called_at_raw,
        "notes": notes,
        "expressions": expressions,
        "commitment_findings": findings,
        "callee_time_mentions": callee_mentions,
        "conflicts": conflicts,
        "counts": counts,
        "disclaimer": DISCLAIMER,
    }


CRAFT_TEMPLATE = """GOAL: {task}
TIME DISCIPLINE: state every commitment as weekday + calendar date + clock time + meridiem
- example: "Wednesday, October 14, at 2 p.m."
- read the full anchor back once and only once
- never use bare "next <weekday>" or "tomorrow" without the calendar date
- if the person proposes a time, confirm it back with both date and clock time
SLOT: {date} at {time}"""


def craft_template(task: str, date: str, time: str) -> str:
    """Emit the absolute-time goal template for plan_call."""
    if not task or not task.strip():
        raise ValueError("craft requires a non-empty --task")
    return CRAFT_TEMPLATE.format(task=task.strip(), date=date, time=time)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    p_analyze = sub.add_parser("analyze", help="Audit temporal anchoring in a finished CALL-E call.")
    group = p_analyze.add_mutually_exclusive_group(required=True)
    group.add_argument("--call-result", default=None, help="Path to a CALL-E call result JSON file.")
    group.add_argument("--transcript", default=None, help="Path to a bare JSON array of turns.")
    p_analyze.add_argument("--called-at", default=None, help="ISO-8601 call timestamp (enables resolution).")

    p_craft = sub.add_parser("craft", help="Emit an absolute-time goal template for the next plan_call.")
    p_craft.add_argument("--task", required=True, help="The call task (non-empty).")
    p_craft.add_argument("--date", required=True, help="The committed calendar date.")
    p_craft.add_argument("--time", required=True, help="The committed clock time with meridiem.")

    args = parser.parse_args(argv)

    if args.command == "craft":
        try:
            print(craft_template(args.task, args.date, args.time))
        except ValueError as exc:
            print(f"ERROR: {exc}", file=sys.stderr)
            return 2
        return 0

    called_at: datetime | None = None
    if args.called_at is not None:
        try:
            called_at = parse_called_at(args.called_at)
        except ValueError as exc:
            print(f"ERROR: {exc}", file=sys.stderr)
            return 2

    source = args.call_result or args.transcript
    path = Path(source)
    if not path.is_file():
        print(f"ERROR: transcript file not found: {path}", file=sys.stderr)
        return 2
    try:
        if args.call_result:
            data = load_call_result(path)
        else:
            data = load_transcript_list(path)
    except json.JSONDecodeError as exc:
        print(f"ERROR: invalid JSON in {path}: {exc}", file=sys.stderr)
        return 2
    except ValueError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    except OSError as exc:
        print(f"ERROR: cannot read {path}: {exc}", file=sys.stderr)
        return 2

    payload = analyze_call(data["turns"], called_at, args.called_at)
    if data.get("call_id"):
        payload = {"call_id": data["call_id"], **payload}
    print(json.dumps(payload, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
