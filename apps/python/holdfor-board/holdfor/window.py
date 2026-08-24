from __future__ import annotations

import os
from datetime import date, datetime, time, timedelta

CHECKIN_DAY = 3
OPENS = time(10, 0)
CLOSES = time(16, 0)
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


def open_at(now: datetime) -> bool:
    """Whether a Reviewer will be there to read what this call brings back today.

    The Reading Window is bound to human availability, not to what would suit the
    Patient. 10:00 because before that she may still be getting up; 16:00 because
    after that she is tired and the surgery is closing, so a flagged Review Item
    would sit unread overnight. Weekends are excluded for the same reason.

    Local time throughout. `db.now_iso()` is UTC because a stored timestamp has to
    be comparable across three machines; this is a question about the hours a
    person is at a desk, which is a local fact and nothing else.
    """
    if now.weekday() >= SATURDAY:
        return False
    return OPENS <= now.time() < CLOSES


# The clock this process is told it is. Not an override of the Reading Window: the rule
# stays 10:00 to 16:00 on a weekday and nothing here relaxes it. What this changes is
# what time the app believes it is, which is the same lever `create_app(clock=...)` and
# `start(now=...)` already hand a test — the docstrings above say so — and which was
# reachable from nowhere else.
#
# The distinction matters because the window has no override on purpose: 16:00 exists
# because a flagged Review Item after it sits unread overnight, and a switch that let
# somebody call at 18:00 anyway would quietly delete the reason. A pinned clock cannot
# be mistaken for the real one, because everything that reads it says so out loud — the
# board carries a banner and the CLI prints a line. Whoever set it can see they set it,
# and so can anybody watching a recording.
PINNED = "HOLDFOR_NOW"


def pinned() -> datetime | None:
    """The time somebody has told this process it is, or nothing.

    Accepts a full ISO datetime, or a bare `HH:MM` meaning that time today. The bare
    form is the one worth reaching for: the due list is judged against this clock too,
    so pinning a different date silently changes which Appointments come due, and
    `HOLDFOR_NOW=11:00` moves the hour without touching the day.

    A value that cannot be read raises rather than falling back to the real clock. The
    fallback would refuse a call for being outside the window while the setting meant
    to open it sat there misspelt.
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
