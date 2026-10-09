"""
Business-hours gate -checks whether it's an acceptable call time at the vendor's location.
Call window: Mon-Fri, 09:00-18:00 in the vendor's local timezone.
"""
from __future__ import annotations
from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

try:
    from timezonefinder import TimezoneFinder
    _TF = TimezoneFinder()
except Exception:
    _TF = None


def get_timezone(lat: float, lon: float) -> str | None:
    if _TF is None or lat is None or lon is None:
        return None
    return _TF.timezone_at(lat=lat, lng=lon)


def is_business_hours(lat: float = None, lon: float = None, tz_name: str = None) -> bool:
    """
    Returns True if it is currently Mon-Fri 09:00-18:00 at the given location.
    Blocks the call (returns False) if the timezone cannot be determined — an
    unresolved timezone means we have no idea what time it actually is for the
    vendor, and calling regardless risked robocalling someone at 3am local time.
    """
    if tz_name is None and lat is not None and lon is not None:
        tz_name = get_timezone(lat, lon)
    if tz_name is None:
        return False  # cannot determine - don't risk calling outside hours
    try:
        tz = ZoneInfo(tz_name)
    except ZoneInfoNotFoundError:
        return False
    now = datetime.now(tz)
    if now.weekday() >= 5:  # Saturday=5, Sunday=6
        return False
    return 9 <= now.hour < 18


def business_hours_reason(lat: float = None, lon: float = None, tz_name: str = None) -> str:
    """Returns a human-readable explanation of the business-hours decision."""
    if tz_name is None and lat is not None and lon is not None:
        tz_name = get_timezone(lat, lon)
    if tz_name is None:
        return "timezone unknown - blocking as a precaution"
    try:
        tz = ZoneInfo(tz_name)
    except ZoneInfoNotFoundError:
        return f"timezone '{tz_name}' not found - blocking as a precaution"
    now = datetime.now(tz)
    days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    ok = "OK" if is_business_hours(tz_name=tz_name) else "OUTSIDE hours"
    return f"{tz_name} {days[now.weekday()]} {now.strftime('%H:%M')} - {ok}"
