"""Call-budget gate — pure logic enforcing the 20-call ceiling in code.

The counter persists to a local JSON state file (default
``.hivemind_budget.json`` next to the checkout; gitignored). Live dials are
refused once the lifetime allowance is spent. No network, no clock.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

DEFAULT_MAX_LIVE_CALLS = 20


class BudgetExhaustedError(RuntimeError):
    """Raised when a live slot is requested with no remaining budget."""


@dataclass(frozen=True)
class Budget:
    """Lifetime live-call allowance. Immutable; requests return new values."""

    max_live_calls: int = DEFAULT_MAX_LIVE_CALLS
    used: int = 0

    def __post_init__(self) -> None:
        if self.max_live_calls < 1:
            raise ValueError("budget must allow at least one live call")
        if not 0 <= self.used <= self.max_live_calls:
            raise ValueError(f"used out of range: {self.used}")

    @property
    def remaining(self) -> int:
        """Live slots left in this budget."""
        return self.max_live_calls - self.used

    def request_slot(self) -> Budget:
        """Consume one live slot or raise BudgetExhausted."""
        if self.remaining < 1:
            raise BudgetExhaustedError(
                f"live budget spent ({self.used}/{self.max_live_calls}); "
                "all further validation is mock-only."
            )
        return Budget(max_live_calls=self.max_live_calls, used=self.used + 1)


def load_budget(path: Path) -> Budget:
    """Read the persisted counter; missing file means a fresh budget.

    Corrupt files fail CLOSED: any parse/shape problem returns a
    fully-consumed budget so request_slot refuses.
    """
    if not path.exists():
        return Budget()
    try:
        data = json.loads(path.read_text())
        max_calls = data["max_live_calls"]
        used = data["used"]
        if isinstance(max_calls, bool) or not isinstance(max_calls, int):
            raise ValueError(f"bad max_live_calls: {max_calls!r}")
        if isinstance(used, bool) or not isinstance(used, int):
            raise ValueError(f"bad used: {used!r}")
        return Budget(max_live_calls=max_calls, used=used)
    except (json.JSONDecodeError, KeyError, TypeError, ValueError):
        return Budget(
            max_live_calls=DEFAULT_MAX_LIVE_CALLS, used=DEFAULT_MAX_LIVE_CALLS
        )


def save_budget(path: Path, budget: Budget) -> None:
    """Persist the counter (parent dir created; file stays gitignored)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"max_live_calls": budget.max_live_calls, "used": budget.used})
    )
