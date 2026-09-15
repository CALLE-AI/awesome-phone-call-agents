"""Recipient-local-time helper shared by calling-window checks.

Fail-closed: raises if recipient_timezone is missing or not a valid IANA
name, rather than guessing a timezone from the phone number's country
code (a US area code does not reliably imply a timezone, and guessing is
exactly what the underlying FCC rule places the burden on the caller to
avoid).
"""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


class UnknownTimezoneError(Exception):
    pass


def recipient_local_datetime(now_utc: datetime, recipient_timezone: str | None) -> datetime:
    if not recipient_timezone:
        raise UnknownTimezoneError(
            "recipient_timezone is required to evaluate a calling-hours rule; "
            "it must be provided or derived from the phone number, never guessed"
        )
    try:
        zone = ZoneInfo(recipient_timezone)
    except ZoneInfoNotFoundError as exc:
        raise UnknownTimezoneError(f"{recipient_timezone!r} is not a valid IANA timezone name") from exc
    return now_utc.astimezone(zone)
