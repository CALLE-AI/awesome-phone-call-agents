from __future__ import annotations

import os
from datetime import date, datetime, time, timedelta

CHECKIN_DAY = 3
SATURDAY = 5


def due_date(seen_on: str) -> date:
    """Day 3 after the Appointment, shifted forward off a weekend.

    Day 3 because 48 to 72 hours is when a post-procedure problem actually shows.
    The shift is forward and never back: ringing on day 2 is too early to hear
    anything, and there is no Reviewer behind a Saturday or a Sunday either.
    """
    due = date.fromisoformat(seen_on) + timedelta(days=CHECKIN_DAY)
    while due.weekday() >= SATURDAY:
        due += timedelta(days=1)
    return due


# The clock this process is told it is. The same lever `create_app(clock=...)` and
# `start(now=...)` already hand a test, reachable from outside the suite.
#
# What it moves is the day. A Check-in Call goes out on day 3 and on no other day, so
# the due list is the thing this changes: `HOLDFOR_NOW=2026-08-20T11:00` puts the app
# on a date where somebody is due, which is what a recording made on the wrong afternoon
# needs. A pinned clock cannot be mistaken for the real one, because everything that
# reads it says so out loud — the board carries a banner and the CLI prints a line.
# Whoever set it can see they set it, and so can anybody watching a recording.
PINNED = "HOLDFOR_NOW"


def pinned() -> datetime | None:
    """The time somebody has told this process it is, or nothing.

    Accepts a full ISO datetime, or a bare `HH:MM` meaning that time today. The full
    form is the one worth reaching for: the due list is judged against this clock, so
    the date is what decides whose call can go out, and `HOLDFOR_NOW=11:00` moves the
    hour without touching the day.

    A value that cannot be read raises rather than falling back to the real clock. The
    fallback would refuse a call for falling on the wrong day while the setting meant
    to move it sat there misspelt.
    """
    raw = (os.environ.get(PINNED) or "").strip()
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw)
    except ValueError:
        pass
    try:
        return datetime.combine(date.today(), time.fromisoformat(raw))
    except ValueError:
        raise ValueError(
            f"{PINNED}={raw!r}: expected an ISO datetime or a HH:MM time"
        ) from None


def clock() -> datetime:
    """What the app believes the time is. The pinned one if there is one."""
    return pinned() or datetime.now()
