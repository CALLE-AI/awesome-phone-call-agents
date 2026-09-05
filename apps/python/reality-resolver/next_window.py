"""Computes the next locally-legal calling window, for the
UNRESOLVED_CALL_BLOCKED path.

Only meaningful when every blocking reason is a calling-window check;
consent, DNC, disclosure, revocation, and the Oregon solicitation cap
are not time-based and do not resolve themselves by waiting, so this
says so plainly instead of guessing a date.

Reuses each jurisdiction module's own window constants directly
(compliance/jurisdictions/us_federal.py, us_oregon.py, fr.py) rather
than duplicating the window numbers here - only the "project forward"
direction is new.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from compliance.jurisdictions import fr, us_federal, us_oregon
from compliance.models import PreCallDecision
from compliance.time_utils import UnknownTimezoneError, recipient_local_datetime

_CALLING_WINDOW_CHECK_SUFFIX = "_calling_window"


def _next_single_window(local_now: datetime, start_hour: int, end_hour: int) -> datetime:
    """Next datetime (same tzinfo as local_now) at which a single daily
    [start_hour, end_hour) local window opens - today if local_now is
    still before start_hour, otherwise tomorrow.
    """
    candidate = local_now.replace(hour=start_hour, minute=0, second=0, microsecond=0)
    if local_now.hour < start_hour:
        return candidate
    return candidate + timedelta(days=1)


def _next_fr_window(local_now: datetime) -> datetime:
    """Next datetime the FR two-weekday-sub-window (10h-13h, 14h-20h,
    Monday-Friday) opens. Does not account for French public holidays -
    the same documented gap fr.py itself already carries; this helper
    inherits it rather than pretending to fix it.
    """
    for day_offset in range(8):  # more than a week of lookahead is never needed
        day = local_now + timedelta(days=day_offset)
        if day.weekday() not in fr.ALLOWED_WEEKDAYS:
            continue
        for start_hour, _end_hour in (fr.MORNING_WINDOW, fr.AFTERNOON_WINDOW):
            candidate = day.replace(hour=start_hour, minute=0, second=0, microsecond=0)
            if candidate > local_now:
                return candidate
    raise RuntimeError("no legal FR window found within 8 days - unexpected, check ALLOWED_WEEKDAYS/MORNING_WINDOW/AFTERNOON_WINDOW")


def next_legal_window(decision: PreCallDecision, recipient_timezone: str | None, now_utc: datetime) -> str:
    """Human-readable description of the next locally-legal calling
    window, or a plain explanation of why none can be computed.
    """
    blocking = tuple(result for result in decision.results if not result.passed)
    if not blocking:
        return "call is not blocked"
    if not all(result.check_name.endswith(_CALLING_WINDOW_CHECK_SUFFIX) for result in blocking):
        return (
            "blocked for a non-time-based reason (consent, DNC, disclosure, revocation, or the "
            "Oregon solicitation cap); no next window to compute"
        )

    try:
        local_now = recipient_local_datetime(now_utc, recipient_timezone)
    except UnknownTimezoneError as exc:
        return str(exc)

    candidates: list[datetime] = []
    for result in blocking:
        if result.check_name == "us_federal_calling_window":
            candidates.append(_next_single_window(local_now, us_federal.WINDOW_START_HOUR, us_federal.WINDOW_END_HOUR))
        elif result.check_name == "us_oregon_calling_window":
            candidates.append(_next_single_window(local_now, us_oregon.WINDOW_START_HOUR, us_oregon.WINDOW_END_HOUR))
        elif result.check_name == "fr_calling_window":
            candidates.append(_next_fr_window(local_now))

    if not candidates:
        return "blocked by a calling-window check this app does not know how to project forward"

    # All failing windows must open simultaneously for the call to be
    # permitted again, so the binding constraint is whichever opens latest.
    next_open_local = max(candidates)
    return f"next legal window opens {next_open_local.isoformat()} ({recipient_timezone} local time)"
