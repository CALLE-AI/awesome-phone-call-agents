"""Decides which appointments need a confirmation call *today*.

- Brand-new appointments whose appointment time is ``confirmation_hours_before``
  away (default 24h) are due for their first call.
- Appointments that were recently called and got a "no answer" are due for a
  retry once ``retry_hours_apart`` hours have passed, up to ``max_retries``.

The scheduler only *selects* candidates; the CLI layer actually dials them.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from .config import Settings, get_settings
from .db import Database


def _parse_dt(value: str) -> Optional[datetime]:
    """Best-effort parse of an appointment datetime string."""
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(value.strip(), fmt)
        except ValueError:
            continue
    return None


def due_appointments(
    db: Database,
    *,
    now: Optional[datetime] = None,
    settings: Optional[Settings] = None,
) -> list:
    """Return appointments that should be called right now.

    Two groups are considered:

    1. **First calls** — appointments whose scheduled time is between
       ``confirmation_hours_before`` and ``confirmation_hours_before + 1``
       hours from ``now``, and whose status is still ``pending``.
    2. **Retries** — appointments in ``pending_retry`` that are eligible via
       :meth:`Database.should_retry`.

    Args:
        db: The database to query.
        now: Reference time (defaults to UTC now).
        settings: Application settings.

    Returns:
        A list of appointment rows (``sqlite3.Row``) that need a call now.
    """
    settings = settings or get_settings()
    now = now or datetime.utcnow()

    due: list = []

    # 1) First calls for today.
    window_start = now + timedelta(hours=settings.confirmation_hours_before)
    window_end = window_start + timedelta(hours=1)
    for row in db.list_appointments(status="pending"):
        apt_dt = _parse_dt(row["appointment_datetime"])
        if apt_dt is None:
            continue
        if window_start <= apt_dt < window_end:
            due.append(row)

    # 2) Retries for no-answer appointments.
    for row in db.list_appointments(status="pending_retry"):
        if db.should_retry(row["id"], settings):
            due.append(row)

    # De-duplicate by appointment id while preserving order.
    seen: set = set()
    unique: list = []
    for row in due:
        if row["id"] not in seen:
            seen.add(row["id"])
            unique.append(row)
    return unique


def format_apt_datetime(value: str) -> tuple[str, str]:
    """Split an appointment datetime into human ``date`` and ``time`` parts."""
    parsed = _parse_dt(value)
    if parsed is None:
        return value, ""
    return parsed.strftime("%Y-%m-%d"), parsed.strftime("%H:%M")
