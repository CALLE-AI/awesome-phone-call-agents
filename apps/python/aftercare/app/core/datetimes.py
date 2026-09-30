from datetime import datetime, timezone


def utc_now_naive() -> datetime:
    """UTC clock time with tzinfo stripped for timezone-naive DateTime columns."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def to_naive_utc(value: datetime | None) -> datetime:
    if value is None:
        return utc_now_naive()
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)
