from abc import ABC, abstractmethod
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from ..core.enums import AgentType
from ..core.exceptions import AgentBoundaryViolation
from ..core.models import CallPlan, EHREvent, make_idempotency_key


class BaseAgent(ABC):
    """
    Abstract base for all domain agents.
    - Stateless: receives one EHREvent, returns one CallPlan, stops.
    - Cannot access CALL-E, EHR adapters, or other agents.
    - Enforces ALLOWED_EVENT_TYPES at runtime before any logic runs.
    """

    ALLOWED_EVENT_TYPES: set[str] = set()
    AGENT_TYPE: AgentType
    APPROVAL_WINDOW_HOURS: int = 4  # PENDING_APPROVAL TTL

    def handle(self, event: EHREvent) -> CallPlan:
        if event.event_type not in self.ALLOWED_EVENT_TYPES:
            raise AgentBoundaryViolation(
                f"{self.__class__.__name__} cannot handle event '{event.event_type}'. "
                f"Allowed: {self.ALLOWED_EVENT_TYPES}"
            )
        return self._build_plan(event)

    @abstractmethod
    def _build_plan(self, event: EHREvent) -> CallPlan:
        ...

    def _make_plan(self, event: EHREvent, script: str) -> CallPlan:
        """Shared factory — ensures every plan is built consistently."""
        reference_id = event.context.get("reference_id", event.patient_id)
        return CallPlan(
            plan_id=str(uuid4()),
            idempotency_key=make_idempotency_key(
                event.patient_id,
                event.event_type,
                self.AGENT_TYPE,
                reference_id,
            ),
            agent=self.AGENT_TYPE,
            patient_id=event.patient_id,
            phone_masked=self._mask_phone(event.patient_phone),
            phone_e164=event.patient_phone,
            script=script,
            priority=event.priority,
            source_event=event.event_type,
            dry_run=True,  # always True until HITL gate approves
            expires_at=datetime.now(timezone.utc) + timedelta(hours=self.APPROVAL_WINDOW_HOURS),
        )

    @staticmethod
    def _mask_phone(phone: str) -> str:
        """Returns masked phone for admin display. Never logs real number."""
        if len(phone) >= 5:
            return phone[:3] + ("*" * (len(phone) - 5)) + phone[-2:]
        return "***"
