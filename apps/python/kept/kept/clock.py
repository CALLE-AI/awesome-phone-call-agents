"""Time boundary. Every decision reads `now` from here so runs are replayable."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Protocol


class Clock(Protocol):
    def now(self) -> datetime: ...


class SystemClock:
    def now(self) -> datetime:
        return datetime.now(timezone.utc)


class FrozenClock:
    """Deterministic clock for tests, simulations and replayed scenarios."""

    def __init__(self, moment: datetime) -> None:
        if moment.tzinfo is None:
            raise ValueError("FrozenClock requires an aware datetime.")
        self._moment = moment.astimezone(timezone.utc)

    def now(self) -> datetime:
        return self._moment
