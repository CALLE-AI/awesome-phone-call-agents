from ..core.enums import AgentType
from ..core.models import CallPlan, EHREvent
from .base import BaseAgent


class PatientAgent(BaseAgent):
    """
    Handles missed appointment and check-in events.
    Produces a CallPlan to confirm rescheduling or follow up on absence.
    Cannot handle billing or lending events.
    """

    ALLOWED_EVENT_TYPES = {"missed_appointment", "no_checkin_48h"}
    AGENT_TYPE = AgentType.PATIENT

    _SCRIPTS: dict[str, str] = {
        "missed_appointment": (
            "Hello, this is a follow-up from your medical practice regarding a missed appointment. "
            "We want to make sure you are doing well and help you reschedule at your convenience. "
            "Could you confirm whether you would like to book a new appointment?"
        ),
        "no_checkin_48h": (
            "Hello, this is a wellness check-in from your care team. "
            "We noticed you have not completed your scheduled check-in. "
            "Could you confirm you are doing well and whether you need any support?"
        ),
    }

    def _build_plan(self, event: EHREvent) -> CallPlan:
        script = self._SCRIPTS[event.event_type]
        return self._make_plan(event, script)
