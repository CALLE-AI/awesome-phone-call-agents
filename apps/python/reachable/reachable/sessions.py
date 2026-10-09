"""Consecutive unexplained session detection, and the code-N deadline.

The rule in full, from docs/SPEC.md §7:

1. Take one pupil's register rows. Sort by (date, session), AM before PM.
2. Drop every row whose date is not a SCHOOL_DAY. A register row whose date has
   no calendar entry is an import error, never assumed to be a school day.
3. Two sessions are consecutive if they are adjacent in the resulting sequence.
   That gives AM->PM on one day, and PM->next school day's AM, closing over
   weekends, holidays and staff training days transparently.
4. A run of `threshold` adjacent sessions, all code N with no reason recorded,
   fires the trigger.
5. The trigger date is the date of the LAST session in the run.
6. A reason recorded later voids the trigger.

Nothing in this module does I/O, so every rule above is directly testable.
"""

from __future__ import annotations

from datetime import date, timedelta

from .models import (
    CODE_N_DEADLINE_SCHOOL_DAYS,
    CalendarDay,
    Dataset,
    RegisterSession,
    Trigger,
)


class CalendarCoverageError(ValueError):
    """A register session falls on a date the calendar does not describe.

    Deliberately fatal to the import. Guessing which days are school days from
    the day of the week would be wrong at every half-term, and the session
    chain, the trigger and the statutory deadline all depend on it.
    """

    def __init__(self, missing: list[date]) -> None:
        self.missing = missing
        shown = ", ".join(d.isoformat() for d in missing[:5])
        more = f" and {len(missing) - 5} more" if len(missing) > 5 else ""
        super().__init__(f"school_calendar.csv has no entry for: {shown}{more}")


def is_school_day(calendar: dict[date, CalendarDay], day: date) -> bool:
    entry = calendar.get(day)
    return bool(entry and entry.is_school_day)


def missing_calendar_dates(
    sessions: list[RegisterSession], calendar: dict[date, CalendarDay]
) -> list[date]:
    return sorted({s.session_date for s in sessions if s.session_date not in calendar})


def school_day_sessions(
    sessions: list[RegisterSession], calendar: dict[date, CalendarDay]
) -> list[RegisterSession]:
    """Sessions on school days only, in statutory order.

    Non-school days are *skipped*, not counted: they break neither the chain nor
    the count, because no register is taken on them.
    """
    kept = [s for s in sessions if is_school_day(calendar, s.session_date)]
    return sorted(kept, key=lambda s: s.sort_key)


def find_triggers(
    dataset: Dataset, pupil_id: str, *, threshold: int = 2
) -> list[Trigger]:
    """Every run of `threshold` adjacent unexplained sessions for one pupil.

    Returns the runs in chronological order. Overlapping runs are not returned:
    once a run fires, scanning resumes after it, so a pupil absent for six
    sessions produces three triggers rather than five.
    """
    if threshold < 1:
        raise ValueError("threshold must be at least 1")

    ordered = school_day_sessions(
        [s for s in dataset.sessions if s.pupil_id == pupil_id], dataset.calendar
    )

    triggers: list[Trigger] = []
    run: list[RegisterSession] = []
    for session in ordered:
        if session.unexplained:
            run.append(session)
            if len(run) == threshold:
                triggers.append(
                    Trigger(
                        pupil_id=pupil_id,
                        trigger_date=run[-1].session_date,
                        sessions=tuple(run),
                    )
                )
                run = []
        else:
            # Any explained or attended session breaks the chain. So does a
            # code N that has since gained a reason, which is what voids a
            # trigger on re-import.
            run = []
    return triggers


def latest_trigger(
    dataset: Dataset, pupil_id: str, *, threshold: int = 2
) -> Trigger | None:
    triggers = find_triggers(dataset, pupil_id, threshold=threshold)
    return triggers[-1] if triggers else None


def all_triggers(dataset: Dataset, *, threshold: int = 2) -> list[Trigger]:
    """Latest trigger per pupil, across the whole dataset."""
    found: list[Trigger] = []
    for pupil_id in sorted({s.pupil_id for s in dataset.sessions}):
        trigger = latest_trigger(dataset, pupil_id, threshold=threshold)
        if trigger is not None:
            found.append(trigger)
    return found


def trigger_still_valid(dataset: Dataset, trigger: Trigger) -> bool:
    """False once any session in the run has gained a recorded reason.

    Re-checked before dialling, because a reason entered by the office between
    the scan and the call is exactly the case where the call must not happen.
    """
    current = {
        (s.session_date, s.slot): s
        for s in dataset.sessions
        if s.pupil_id == trigger.pupil_id
    }
    for session in trigger.sessions:
        latest = current.get((session.session_date, session.slot))
        if latest is None or not latest.unexplained:
            return False
    return True


def add_school_days(
    calendar: dict[date, CalendarDay], start: date, count: int
) -> date | None:
    """The date `count` school days after `start`, or None if the calendar runs out.

    Used for the code-N amendment deadline. The statutory unit is **school
    days**, not working days -- see docs/SOURCES.md C2, where the guidance
    contradicts itself and the Regulations settle it.
    """
    if count <= 0:
        return start
    remaining = count
    day = start
    horizon = max(calendar) if calendar else start
    while remaining > 0:
        day = day + timedelta(days=1)
        if day > horizon:
            return None
        if is_school_day(calendar, day):
            remaining -= 1
    return day


def code_n_deadline(
    calendar: dict[date, CalendarDay],
    session_date: date,
    *,
    school_days: int = CODE_N_DEADLINE_SCHOOL_DAYS,
) -> date | None:
    """The date by which a code N must be amended, or None if unknown.

    Displayed as a date rather than a countdown, and always alongside the rule
    that produced it, because a school user may have seen the guidance's other
    wording.
    """
    return add_school_days(calendar, session_date, school_days)
