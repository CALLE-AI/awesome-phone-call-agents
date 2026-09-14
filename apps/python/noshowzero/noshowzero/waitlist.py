"""Choosing who is offered a released slot. Pure: no I/O, no calls.

Rules, in order, for each waitlist entry (oldest first):

1. only entries with ``status: waiting``;
2. the same service as the released appointment;
3. ``consent_to_call: true`` - the patient agreed to be called about openings;
4. never the same patient twice for the same slot (``offered_slots``);
5. the slot, in the clinic's timezone, must fit the stated preferred dates and times.

The first entry that passes every rule is the one candidate. Only one patient is offered a slot at
a time, so a slot can never be promised to two people.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from noshowzero.task import parse_time

TIME_WINDOWS = {"morning": (7, 12), "afternoon": (12, 17), "evening": (17, 20)}


def slot_fits(slot_local: datetime, preferred_dates: list[str], preferred_times: list[str]) -> str | None:
    """None when the slot fits the preferences, otherwise the reason it does not."""
    if preferred_dates and slot_local.strftime("%Y-%m-%d") not in preferred_dates:
        return "date not in preferred dates"
    if preferred_times:
        windows = [TIME_WINDOWS[t] for t in preferred_times if t in TIME_WINDOWS]
        if not any(lo <= slot_local.hour < hi for lo, hi in windows):
            return f"time outside preferred {', '.join(preferred_times)}"
    return None


def pick_candidate(
    entries: list[dict[str, Any]],
    *,
    slot_id: str,
    slot_at: str,
    service_type: str,
    timezone: str,
) -> tuple[dict[str, Any] | None, list[tuple[str, str]]]:
    """Return (candidate or None, [(entry_id, reason skipped), ...]) for one released slot."""
    slot_local = parse_time(slot_at).astimezone(ZoneInfo(timezone))
    skipped: list[tuple[str, str]] = []
    for entry in sorted(entries, key=lambda e: str(e.get("created_at") or "")):
        entry_id = str(entry.get("entry_id"))
        if entry.get("status", "waiting") != "waiting":
            skipped.append((entry_id, f"status is {entry.get('status')}"))
            continue
        if entry.get("service_type") != service_type:
            skipped.append((entry_id, f"waiting for {entry.get('service_type')}"))
            continue
        if entry.get("consent_to_call") is not True:
            skipped.append((entry_id, "no consent_to_call"))
            continue
        if slot_id in (entry.get("offered_slots") or []):
            skipped.append((entry_id, "already offered this slot"))
            continue
        reason = slot_fits(slot_local, entry.get("preferred_dates") or [], entry.get("preferred_times") or [])
        if reason:
            skipped.append((entry_id, reason))
            continue
        return entry, skipped
    return None, skipped
