from ..core.enums import AgentType
from ..core.models import CallPlan, EHREvent
from .base import BaseAgent


class LendingAgent(BaseAgent):
    """
    Handles loan inquiry submissions.
    Produces a CallPlan to qualify intent and collect soft data.
    Cannot handle patient care or billing events.
    No financial specifics, amounts, or terms disclosed during the call.
    """

    ALLOWED_EVENT_TYPES = {"loan_inquiry_submitted"}
    AGENT_TYPE = AgentType.LENDING
    APPROVAL_WINDOW_HOURS = 2  # lending calls are time-sensitive

    _SCRIPTS: dict[str, str] = {
        "loan_inquiry_submitted": (
            "Hello, this is a follow-up from the lending team regarding your recent inquiry. "
            "We want to make sure we understand your needs before connecting you with an advisor. "
            "Could you confirm you submitted a loan inquiry and briefly describe what the funds "
            "would primarily be used for? This helps us match you with the right options."
        ),
    }

    def _build_plan(self, event: EHREvent) -> CallPlan:
        script = self._SCRIPTS[event.event_type]
        return self._make_plan(event, script)
