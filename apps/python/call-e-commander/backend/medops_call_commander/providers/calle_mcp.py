from datetime import datetime
from typing import Any, Dict

from apps.python.medops_call_commander.config import load_calle_config
from apps.python.medops_call_commander.core.enums import CallOutcome
from apps.python.medops_call_commander.core.models import CallPlan, CallResult
from apps.python.medops_call_commander.providers.base import CallProvider
from apps.python.medops_call_commander.providers.calle_client import CalleClient


class CalleMcpProvider(CallProvider):
    def __init__(self) -> None:
        config = load_calle_config()
        self._client = CalleClient(api_key=config.api_key, base_url=config.base_url)

    def dispatch(self, plan: CallPlan) -> str:
        payload: Dict[str, Any] = self._client.calls_create(
            task=plan.script,
            phone=plan.phone_e164,
            plan_id=plan.plan_id,
        )
        return str(payload.get("id", f"call_{plan.plan_id[:8]}"))

    def get_result(self, plan_id: str, external_id: str) -> CallResult:
        payload: Dict[str, Any] = self._client.calls_get(external_id)
        status = payload.get("status")
        task_completed = bool(payload.get("task_completed"))

        if status == "completed" and task_completed:
            outcome = CallOutcome.ANSWERED
        elif status == "failed":
            outcome = CallOutcome.FAILED
        else:
            outcome = CallOutcome.OUTCOME_UNKNOWN

        structured = payload.get("structured_result") or {}
        completed_at_str = payload.get("completed_at")
        if completed_at_str:
            try:
                completed_at = datetime.fromisoformat(completed_at_str)
            except Exception:
                completed_at = datetime.utcnow()
        else:
            completed_at = datetime.utcnow()

        return CallResult(
            plan_id=plan_id,
            outcome=outcome,
            transcript_ref=external_id,
            structured=structured,
            completed_at=completed_at,
        )

    def cancel(self, external_id: str) -> None:
        self._client.calls_cancel(external_id)
