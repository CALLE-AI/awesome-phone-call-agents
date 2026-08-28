"""Strict compact duration parsing shared by QuoteWake configuration."""

from __future__ import annotations

from datetime import timedelta
import re


_COMPACT_DURATION = re.compile(
    r"(?:(?P<days>[0-9]+)d)?"
    r"(?:(?P<hours>[0-9]+)h)?"
    r"(?:(?P<minutes>[0-9]+)m)?"
    r"(?:(?P<seconds>[0-9]+)s)?"
)


def parse_duration(
    value: object,
    *,
    context: str = "duration",
    allow_zero: bool = False,
) -> timedelta:
    """Parse a strict, compact duration into a :class:`timedelta`.

    Components must be integer ``d``, ``h``, ``m``, and ``s`` values in that
    order, with each unit appearing at most once.  Whitespace, signs,
    decimals, and bare numbers are deliberately rejected.  Configuration
    values may opt into an all-zero duration (normally written as ``0s``).
    """

    if not isinstance(value, str) or not value:
        raise ValueError(f"{context} must be a duration string using d/h/m/s components.")
    match = _COMPACT_DURATION.fullmatch(value)
    if match is None:
        raise ValueError(
            f"{context} must be a strict duration string using ordered integer d/h/m/s components."
        )

    try:
        days = int(match.group("days") or "0")
        hours = int(match.group("hours") or "0")
        minutes = int(match.group("minutes") or "0")
        seconds = int(match.group("seconds") or "0")
    except ValueError as exc:
        # Python can reject an integer with more digits than its safety limit;
        # expose that as the same contextual duration overflow as timedelta.
        raise ValueError(f"{context} is out of range.") from exc

    if not allow_zero and not any((days, hours, minutes, seconds)):
        raise ValueError(f"{context} must be greater than zero.")

    try:
        return timedelta(days=days, hours=hours, minutes=minutes, seconds=seconds)
    except (OverflowError, ValueError) as exc:
        raise ValueError(f"{context} is out of range.") from exc


parse_compact_duration = parse_duration
