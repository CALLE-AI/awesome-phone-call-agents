"""Calendar matching: which of a clinic's offered slots fall inside the user's
free windows. Pure functions, no CALL-E dependency."""

from __future__ import annotations

from datetime import datetime

from .types import ClinicSlot, TimeWindow


def describe_windows(windows: list[TimeWindow]) -> str:
    """The user's free windows as text a voice agent can say, e.g.
    'Thursday, September 24, between 2:00 PM and 3:00 PM'. Built by hand
    because Windows' strftime doesn't support %-d / %-I."""

    def clock(moment) -> str:
        return f"{moment.hour % 12 or 12}:{moment.minute:02d} {'AM' if moment.hour < 12 else 'PM'}"

    return "; ".join(
        f"{w.start:%A, %B} {w.start.day}, between {clock(w.start)} and {clock(w.end)}"
        for w in windows
    )


def slot_in_windows(slot: ClinicSlot, windows: list[TimeWindow]) -> bool:
    """True if any window contains the slot's start time."""
    slot_dt = datetime.fromisoformat(f"{slot.date}T{slot.time}:00")
    return any(w.start <= slot_dt < w.end for w in windows)


def matched_slots(clinic_slots: list[ClinicSlot], user_free: list[TimeWindow]) -> list[ClinicSlot]:
    """The clinic's offered slots the user can attend, in the order the clinic
    offered them (so "first" means first offered, not earliest)."""
    return [s for s in clinic_slots if slot_in_windows(s, user_free)]
