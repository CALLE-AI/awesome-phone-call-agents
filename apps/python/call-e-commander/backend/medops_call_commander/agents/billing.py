from ..core.enums import AgentType
from ..core.models import CallPlan, EHREvent
from .base import BaseAgent


class BillingAgent(BaseAgent):
    """
    Handles overdue invoice events at 30, 60, and 90 day thresholds.
    Produces a CallPlan to confirm receipt and negotiate payment arrangement.
    Cannot handle patient or lending events.
    Script escalates in urgency by threshold — no balance amounts disclosed over the phone.
    """

    ALLOWED_EVENT_TYPES = {"invoice_30_days", "invoice_60_days", "invoice_90_days"}
    AGENT_TYPE = AgentType.BILLING
    APPROVAL_WINDOW_HOURS = 4

    _SCRIPTS: dict[str, str] = {
        "invoice_30_days": (
            "Hello, this is a courtesy call from your medical practice billing department. "
            "Our records show an outstanding balance on your account. "
            "We would like to help you resolve this — could you confirm you received your statement "
            "and let us know if you would like to discuss payment options?"
        ),
        "invoice_60_days": (
            "Hello, this is the billing department at your medical practice. "
            "We have an outstanding balance on your account that is now 60 days past due. "
            "We would like to work with you on a payment arrangement. "
            "Could you confirm the best way to reach you to discuss this?"
        ),
        "invoice_90_days": (
            "Hello, this is an important message from your medical practice billing department. "
            "Your account has an outstanding balance that is now 90 days past due. "
            "We need to speak with you urgently to avoid further action. "
            "Please confirm you received this message and provide a time to discuss your account."
        ),
    }

    def _build_plan(self, event: EHREvent) -> CallPlan:
        script = self._SCRIPTS[event.event_type]
        return self._make_plan(event, script)
