"""Market resolution: the language and the clock come from the lead's number.

Nothing here reads a country field supplied by the seller. The E.164 prefix of
the number that is actually dialled decides the locale, the timezone, and the
local calling window, so a mislabelled CRM row cannot cause a call in the wrong
language or at the wrong hour.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

#: Applied to every market. The tuple in `Market.business_hours` carries the
#: hours; the calling days are a single policy for the whole app.
BUSINESS_WEEKDAYS: tuple[int, ...] = (0, 1, 2, 3, 4)


@dataclass(frozen=True)
class Market:
    country: str
    locale: str
    timezone: str
    business_hours: tuple[int, int]  # local start and end hour
    region_hint: str

    def contains(self, local_moment: datetime) -> bool:
        start, end = self.business_hours
        return (
            local_moment.weekday() in BUSINESS_WEEKDAYS
            and start <= local_moment.hour < end
        )

    def hours_label(self) -> str:
        return hours_label(self.business_hours)


# E.164 prefix -> market
MARKETS: dict[str, Market] = {
    "+258": Market("Mozambique", "pt-MZ", "Africa/Maputo", (8, 18), "MZ"),
    "+244": Market("Angola", "pt-AO", "Africa/Luanda", (8, 18), "AO"),
    "+255": Market("Tanzania", "en-TZ", "Africa/Dar_es_Salaam", (8, 18), "TZ"),
    "+254": Market("Kenya", "en-KE", "Africa/Nairobi", (8, 18), "KE"),
    "+1": Market("Test line", "en-US", "America/New_York", (9, 20), "US"),
}


def resolve_market(phone: str) -> Market:
    """Return the market for an E.164 number, longest prefix first."""
    for prefix in sorted(MARKETS, key=len, reverse=True):
        if phone.startswith(prefix):
            return MARKETS[prefix]
    raise ValueError(f"unsupported destination for {phone[:4]}***")


def supported_prefixes() -> tuple[str, ...]:
    return tuple(sorted(MARKETS, key=len, reverse=True))


def hours_label(business_hours: tuple[int, int]) -> str:
    names = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
    days = ", ".join(names[day] for day in BUSINESS_WEEKDAYS)
    start, end = business_hours
    return f"{start:02d}:00-{end:02d}:00 local ({days})"


def local_time(timezone: str, moment: datetime) -> datetime:
    """Convert an aware datetime into the lead's local time."""
    if moment.tzinfo is None:
        raise ValueError("moment must be timezone-aware")
    return moment.astimezone(ZoneInfo(timezone))


def within_business_hours(
    timezone: str, business_hours: tuple[int, int], moment: datetime
) -> bool:
    current = local_time(timezone, moment)
    start, end = business_hours
    return current.weekday() in BUSINESS_WEEKDAYS and start <= current.hour < end


def next_business_start(
    timezone: str, business_hours: tuple[int, int], moment: datetime
) -> datetime:
    """Return the next local datetime at which calling this lead is allowed."""
    current = local_time(timezone, moment)
    if within_business_hours(timezone, business_hours, moment):
        return current
    candidate = current.replace(minute=0, second=0, microsecond=0)
    start, end = business_hours
    for _ in range(24 * 14):
        candidate += timedelta(hours=1)
        if candidate.weekday() in BUSINESS_WEEKDAYS and start <= candidate.hour < end:
            return candidate
    raise ValueError(f"business hours {hours_label(business_hours)} never open")
