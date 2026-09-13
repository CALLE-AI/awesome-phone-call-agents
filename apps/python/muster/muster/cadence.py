"""When to call again.

The whole argument for doing this by phone is that a weak check run often beats
a strong check run once a year. That argument only means something if the
interval actually responds to the evidence, so it lives here in code rather
than in the README.

An interval is never a deadline for the subject. Nothing expires, and missing a
cycle changes no payment.
"""

from __future__ import annotations

from datetime import date, timedelta

from .models import Attestation, Grade

#: Days until the next attempt, by what the last call established. `None` means
#: the schedule stops because a person now owns the case.
INTERVAL_DAYS: dict[Grade, int | None] = {
    Grade.CONFIRMED_LIVE: 30,
    Grade.PRESUMED_LIVE_WEAK: 7,
    Grade.THIRD_PARTY_CLAIM: 2,
    Grade.UNPROVEN: 3,
    Grade.CONTRA: 1,
    Grade.NEEDS_HUMAN: None,
}


def interval_days(grade: Grade) -> int | None:
    return INTERVAL_DAYS[grade]


def next_due(attestation: Attestation, after: date | None = None) -> date | None:
    """The date of the next attempt, or None when a human owns the case."""
    days = INTERVAL_DAYS[attestation.grade]
    if days is None:
        return None
    start = after or attestation.graded_at.date()
    return start + timedelta(days=days)


def worst_case_detection_days(ladder_days: int, confirmed_interval: int | None = None) -> int:
    """Longest a death can go unnoticed once the schedule is running.

    One full interval before the next call, plus the time the escalation ladder
    takes to reach a human. This is a model of the schedule, not a measurement
    of any real scheme.
    """
    interval = confirmed_interval if confirmed_interval is not None else INTERVAL_DAYS[Grade.CONFIRMED_LIVE]
    return int(interval or 0) + ladder_days
