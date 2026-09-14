"""
CallExecutor
============
Dispatches an approved CallPlan to CALL-E and polls for the outcome.

Failure semantics:
- A provider-confirmed failure (CALL-E itself reports the call failed)
  results in outcome=FAILED.
- A network/read error while dispatching or polling does NOT prove the
  call failed — CALL-E may have accepted or even completed it while we
  simply could not confirm the result. Those cases surface as
  OUTCOME_UNKNOWN via the provider layer and this executor keeps polling
  rather than assuming failure.
- Only after the polling window is exhausted without ANY confirmed
  outcome do we mark the plan FAILED, and even then the message is
  explicit that this reflects "unresolved", not "confirmed failed".
"""

import os
import time
from datetime import datetime, timezone

from medops_call_commander.core.enums import CallOutcome, PlanState
from medops_call_commander.core.models import CallPlan, CallResult
from medops_call_commander.providers.calle_mcp import CalleMcpProvider


class CallDispatchError(Exception):
    """Raised when CALL-E dispatch or polling could not confirm an outcome."""


class CallExecutor:
    def __init__(self, provider: CalleMcpProvider | None = None) -> None:
        self._provider: CalleMcpProvider = provider  # type: ignore[assignment]
        self._max_attempts = int(os.environ.get("CALLE_POLL_MAX_ATTEMPTS", "20"))
        self._poll_interval = float(os.environ.get("CALLE_POLL_INTERVAL", "3.0"))

    def run(self, plan: CallPlan) -> CallResult:
        if not plan.is_dispatchable():
            raise CallDispatchError("CallPlan is not in a dispatchable state.")

        external_id = self._provider.dispatch(plan)

        plan.result_ref = external_id
        plan.dispatched_at = datetime.now(timezone.utc)
        plan.state = PlanState.DISPATCHED

        for attempt in range(1, self._max_attempts + 1):
            result = self._provider.get_result(plan.plan_id, external_id)

            if result.outcome == CallOutcome.FAILED:
                plan.state = PlanState.FAILED
                return result

            if result.outcome != CallOutcome.OUTCOME_UNKNOWN:
                plan.state = PlanState.COMPLETED
                return result

            time.sleep(self._poll_interval)

        plan.state = PlanState.FAILED
        raise CallDispatchError(
            f"CALL-E call '{external_id}' did not resolve to a confirmed outcome after "
            f"{self._max_attempts} polling attempts "
            f"({self._max_attempts * self._poll_interval:.0f}s). This means the outcome is "
            f"UNKNOWN, not that the call is confirmed failed. Check the CALL-E dashboard "
            f"directly for the call's actual status before re-queuing."
        )
