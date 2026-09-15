"""Table-driven session detection.

The trigger is `threshold` consecutive unexplained (code N) register sessions,
where consecutive means AM->PM or PM->next SCHOOL DAY's AM. Weekends, holidays
and staff training days are skipped, not counted.
"""

from __future__ import annotations

from datetime import date

import pytest

from reachable.models import (
    CalendarDay,
    Dataset,
    DayType,
    Pupil,
    RegisterSession,
    SessionSlot,
)
from reachable.sessions import (
    CalendarCoverageError,
    code_n_deadline,
    find_triggers,
    missing_calendar_dates,
    school_day_sessions,
    trigger_still_valid,
)

PUPIL = "P-1041"

# A fortnight: two school weeks around a weekend, with an INSET day and a
# half-term holiday placed to break the naive "next calendar day" assumption.
CALENDAR_SPEC = {
    date(2026, 9, 7): DayType.SCHOOL_DAY,   # Mon
    date(2026, 9, 8): DayType.SCHOOL_DAY,   # Tue
    date(2026, 9, 9): DayType.INSET,        # Wed - staff training
    date(2026, 9, 10): DayType.SCHOOL_DAY,  # Thu
    date(2026, 9, 11): DayType.SCHOOL_DAY,  # Fri
    date(2026, 9, 12): DayType.WEEKEND,     # Sat
    date(2026, 9, 13): DayType.WEEKEND,     # Sun
    date(2026, 9, 14): DayType.SCHOOL_DAY,  # Mon
    date(2026, 9, 15): DayType.HOLIDAY,     # Tue - half-term
    date(2026, 9, 16): DayType.SCHOOL_DAY,  # Wed
    date(2026, 9, 17): DayType.SCHOOL_DAY,  # Thu
    date(2026, 9, 18): DayType.SCHOOL_DAY,  # Fri
}


def calendar() -> dict[date, CalendarDay]:
    return {d: CalendarDay(day=d, day_type=t) for d, t in CALENDAR_SPEC.items()}


def build(*sessions: tuple[str, str, str, str]) -> Dataset:
    """Each tuple is (iso date, AM|PM, code, reason_recorded)."""
    rows = [
        RegisterSession(
            pupil_id=PUPIL,
            session_date=date.fromisoformat(d),
            slot=SessionSlot(slot),
            code=code,
            reason_recorded=reason,
        )
        for d, slot, code, reason in sessions
    ]
    return Dataset(
        pupils={PUPIL: Pupil(pupil_id=PUPIL, first_name="Ivy", last_name="Brennan")},
        sessions=rows,
        calendar=calendar(),
    )


CASES = [
    (
        "AM then PM on one day fires",
        [("2026-09-07", "AM", "N", ""), ("2026-09-07", "PM", "N", "")],
        1,
        date(2026, 9, 7),
    ),
    (
        "PM then next school day AM fires",
        [("2026-09-07", "PM", "N", ""), ("2026-09-08", "AM", "N", "")],
        1,
        date(2026, 9, 8),
    ),
    (
        "across a weekend: Friday PM then Monday AM fires",
        [("2026-09-11", "PM", "N", ""), ("2026-09-14", "AM", "N", "")],
        1,
        date(2026, 9, 14),
    ),
    (
        "across a staff training day: Tue PM then Thu AM fires",
        [("2026-09-08", "PM", "N", ""), ("2026-09-10", "AM", "N", "")],
        1,
        date(2026, 9, 10),
    ),
    (
        "across a half-term holiday: Mon PM then Wed AM fires",
        [("2026-09-14", "PM", "N", ""), ("2026-09-16", "AM", "N", "")],
        1,
        date(2026, 9, 16),
    ),
    (
        "an attended session between breaks the chain",
        [
            ("2026-09-07", "AM", "N", ""),
            ("2026-09-07", "PM", "/", ""),
            ("2026-09-08", "AM", "N", ""),
        ],
        0,
        None,
    ),
    (
        "a reason entered between sessions breaks the chain",
        [
            ("2026-09-07", "AM", "N", ""),
            ("2026-09-07", "PM", "N", "Mum called, unwell"),
            ("2026-09-08", "AM", "N", ""),
        ],
        0,
        None,
    ),
    (
        "an AM/PM gap still counts: PM missing, AM then next AM are adjacent",
        [("2026-09-07", "AM", "N", ""), ("2026-09-08", "AM", "N", "")],
        1,
        date(2026, 9, 8),
    ),
    (
        "a single unexplained session does not fire",
        [("2026-09-07", "AM", "N", "")],
        0,
        None,
    ),
    (
        "an authorised absence code does not fire",
        [("2026-09-07", "AM", "I", ""), ("2026-09-07", "PM", "I", "")],
        0,
        None,
    ),
    (
        "sessions on non-school days are skipped entirely",
        [
            ("2026-09-12", "AM", "N", ""),
            ("2026-09-13", "AM", "N", ""),
        ],
        0,
        None,
    ),
    (
        "four unexplained sessions produce two non-overlapping triggers",
        [
            ("2026-09-07", "AM", "N", ""),
            ("2026-09-07", "PM", "N", ""),
            ("2026-09-08", "AM", "N", ""),
            ("2026-09-08", "PM", "N", ""),
        ],
        2,
        date(2026, 9, 8),
    ),
    (
        "input order does not matter; sorting is by date then AM before PM",
        [("2026-09-07", "PM", "N", ""), ("2026-09-07", "AM", "N", "")],
        1,
        date(2026, 9, 7),
    ),
]


@pytest.mark.parametrize(
    ("label", "sessions", "expected_count", "expected_date"),
    CASES,
    ids=[c[0] for c in CASES],
)
def test_session_detection(label, sessions, expected_count, expected_date):
    triggers = find_triggers(build(*sessions), PUPIL, threshold=2)
    assert len(triggers) == expected_count, label
    if expected_date is not None:
        assert triggers[-1].trigger_date == expected_date, label


def test_trigger_date_is_the_last_session_in_the_run():
    triggers = find_triggers(
        build(("2026-09-10", "PM", "N", ""), ("2026-09-11", "AM", "N", "")), PUPIL
    )
    assert triggers[0].trigger_date == date(2026, 9, 11)
    assert len(triggers[0].sessions) == 2


def test_threshold_is_configurable():
    data = build(
        ("2026-09-07", "AM", "N", ""),
        ("2026-09-07", "PM", "N", ""),
        ("2026-09-08", "AM", "N", ""),
    )
    assert len(find_triggers(data, PUPIL, threshold=3)) == 1
    assert len(find_triggers(data, PUPIL, threshold=4)) == 0
    assert len(find_triggers(data, PUPIL, threshold=1)) == 3


def test_threshold_must_be_positive():
    with pytest.raises(ValueError):
        find_triggers(build(("2026-09-07", "AM", "N", "")), PUPIL, threshold=0)


def test_a_reason_recorded_later_voids_the_trigger():
    """The case that must not produce a call: the office entered a reason
    between the scan and the dial."""
    data = build(("2026-09-07", "AM", "N", ""), ("2026-09-07", "PM", "N", ""))
    trigger = find_triggers(data, PUPIL)[0]
    assert trigger_still_valid(data, trigger)

    updated = build(("2026-09-07", "AM", "N", ""), ("2026-09-07", "PM", "N", "Dad rang in"))
    assert not trigger_still_valid(updated, trigger)


def test_missing_calendar_coverage_is_detected():
    sessions = [
        RegisterSession(PUPIL, date(2026, 12, 25), SessionSlot.AM, "N"),
    ]
    assert missing_calendar_dates(sessions, calendar()) == [date(2026, 12, 25)]


def test_calendar_coverage_error_names_the_dates():
    error = CalendarCoverageError([date(2026, 12, 25), date(2026, 12, 26)])
    assert "2026-12-25" in str(error)


def test_school_day_sessions_drops_non_school_days_and_sorts():
    data = build(
        ("2026-09-13", "AM", "N", ""),  # Sunday
        ("2026-09-11", "PM", "N", ""),
        ("2026-09-11", "AM", "N", ""),
    )
    ordered = school_day_sessions(data.sessions, data.calendar)
    assert [(s.session_date, s.slot.value) for s in ordered] == [
        (date(2026, 9, 11), "AM"),
        (date(2026, 9, 11), "PM"),
    ]


def test_code_n_deadline_counts_school_days_not_calendar_days():
    """Five SCHOOL days from Monday 7 Sept, over an INSET day and a weekend.

    School days after the 7th: 8, 10, 11, 14, 16 -- the 9th is INSET, the 12th
    and 13th are the weekend, the 15th is half-term. A working-day count would
    give the wrong date, which is why the calendar drives this.
    """
    assert code_n_deadline(calendar(), date(2026, 9, 7)) == date(2026, 9, 16)


def test_code_n_deadline_returns_none_past_the_calendar_horizon():
    assert code_n_deadline(calendar(), date(2026, 9, 17)) is None
