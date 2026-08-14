"""
CallExecutor
============
Dispatches an approved CallPlan to CALL-E and polls for the outcome.

Production behaviour:
- Polls CALL-E at most POLL_MAX_ATTEMPTS times (default: 20, env: CALLE_POLL_MAX_ATTEMPTS).
- Sleeps POLL_INTERVAL_SECONDS between attempts (default: 3s, env: CALLE_POLL_INTERVAL).
- Raises CallDispatchError if the call does not complete within the polling window.
  The plan is marked FAILED so the admin can investigate in the audit log.
"""

import os
import time
from datetime import datetime, timezone

from apps.python.medops_call_commander.core.enums import CallOutcome, PlanState
from apps.python.medops_call_commander.core.models import CallPlan, CallResult
from apps.python.medops_call_commander.providers.calle_mcp import CalleMcpProvider


class CallDispatchError(Exception):
    """Raised when CALL-E dispatch or polling fails in production."""


class CallExecutor:
    def __init__(self, provider: CalleMcpProvider | None = None) -> None:
        # Provider may be None in test mode; tests replace _provider after construction.
        # In production, always pass a fully configured CalleMcpProvider.
        self._provider: CalleMcpProvider = provider  # type: ignore[assignment]
        self._max_attempts = int(os.environ.get("CALLE_POLL_MAX_ATTEMPTS", "20"))
        self._poll_interval = float(os.environ.get("CALLE_POLL_INTERVAL", "3.0"))

    def run(self, plan: CallPlan) -> CallResult:
        if not plan.is_dispatchable():
            raise CallDispatchError("CallPlan is not in a dispatchable state.")

        # Dispatch to CALL-E
        try:
            external_id = self._provider.dispatch(plan)
        except Exception as exc:
            plan.state = PlanState.FAILED
            raise CallDispatchError(f"CALL-E dispatch failed: {exc}") from exc

        plan.result_ref = external_id
        plan.dispatched_at = datetime.now(timezone.utc)
        plan.state = PlanState.DISPATCHED

        # Poll for outcome
        for attempt in range(1, self._max_attempts + 1):
            try:
                result = self._provider.get_result(plan.plan_id, external_id)
            except Exception as exc:
                plan.state = PlanState.FAILED
                raise CallDispatchError(
                    f"CALL-E polling failed on attempt {attempt}: {exc}"
                ) from exc

            if result.outcome != CallOutcome.OUTCOME_UNKNOWN:
                plan.state = (
                    PlanState.FAILED
                    if result.outcome == CallOutcome.FAILED
                    else PlanState.COMPLETED
                )
                return result

            time.sleep(self._poll_interval)

        # Polling window exhausted — do not silently succeed
        plan.state = PlanState.FAILED
        raise CallDispatchError(
            f"CALL-E call '{external_id}' did not resolve after "
            f"{self._max_attempts} polling attempts "
            f"({self._max_attempts * self._poll_interval:.0f}s). "
            f"Check the CALL-E dashboard for call status and re-queue if needed."
        )
