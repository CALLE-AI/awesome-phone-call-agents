from __future__ import annotations

from typing import Protocol

from ..core.models import CallPlan, CallResult


class CallProvider(Protocol):
    """Narrow provider boundary. Implementations may not mutate CallPlan state."""

    def dispatch(self, plan: CallPlan) -> str:
        """Dispatch call to provider. Returns provider call ID."""
        ...

    def get_result(self, plan_id: str, external_id: str) -> CallResult:
        """Fetch call outcome and structured result."""
        ...

    def cancel(self, external_id: str) -> None:
        """Cancel an in-progress or queued call."""
        ...
