"""Risk-aware scheduling for the fields most likely to be stale."""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import UTC, date, datetime

VOLATILITY = {"schedule": 1.8, "eligibility": 1.5, "status": 1.4, "phone": 0.8, "address": 0.5}


@dataclass(frozen=True, slots=True)
class PrioritySignals:
    assured_date: date | None
    fields: tuple[str, ...] = ("schedule",)
    referrals_30d: int = 0
    failure_reports_30d: int = 0
    seasonality: float = 0
    days_since_contact: int | None = None


def priority_score(signals: PrioritySignals, *, today: date | None = None) -> float:
    """Score staleness without allowing volume to drown out a live failure report."""
    today = today or datetime.now(UTC).date()
    age_days = 365 if signals.assured_date is None else max(0, (today - signals.assured_date).days)
    volatility = max((VOLATILITY.get(field, 1.0) for field in signals.fields), default=1.0)
    staleness = min(age_days, 730) * volatility
    volume = 12 * math.log1p(max(0, signals.referrals_30d))
    # One first-hand failure report outranks even two years of passive staleness.
    failures = 1500 * max(0, signals.failure_reports_30d)
    seasonality = 80 * min(1.0, max(0.0, signals.seasonality))
    contact_penalty = 0.0
    if signals.days_since_contact is not None and signals.days_since_contact < 14:
        contact_penalty = (14 - max(0, signals.days_since_contact)) * 35
    return round(max(0.0, staleness + volume + failures + seasonality - contact_penalty), 2)
