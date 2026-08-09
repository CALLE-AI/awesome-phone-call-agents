"""Centralized QuoteWake selection policy."""

from __future__ import annotations

import os
from dataclasses import dataclass


MAX_ATTEMPTS = 3
DEFAULT_ALLOWED_QUOTE_STATUSES = frozenset({"Presented"})
ACTIONABLE_FOLLOW_UP_STATUSES = frozenset({"Pending", "Retry"})


@dataclass(frozen=True)
class SelectionPolicy:
    """Configurable business policy for the read-only selection stage."""

    max_attempts: int = MAX_ATTEMPTS
    actionable_follow_up_statuses: frozenset[str] = ACTIONABLE_FOLLOW_UP_STATUSES
    allowed_quote_statuses: frozenset[str] = DEFAULT_ALLOWED_QUOTE_STATUSES


def configured_quote_statuses(values: list[str] | None = None) -> frozenset[str]:
    """Read allowed commercial statuses from CLI values or environment.

    The default is deliberately centralized and can be replaced without
    changing SOQL or the pure selection functions.
    """

    if values:
        statuses = values
    else:
        configured = os.environ.get("QUOTEWAKE_ALLOWED_QUOTE_STATUSES", "")
        statuses = configured.split(",") if configured.strip() else list(
            DEFAULT_ALLOWED_QUOTE_STATUSES
        )
    normalized = frozenset(status.strip() for status in statuses if status.strip())
    if not normalized:
        raise ValueError(
            "At least one allowed commercial Quote status is required. "
            "Use --allowed-quote-status or QUOTEWAKE_ALLOWED_QUOTE_STATUSES."
        )
    return normalized

