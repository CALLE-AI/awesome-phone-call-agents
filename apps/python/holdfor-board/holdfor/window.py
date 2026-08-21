from __future__ import annotations

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
