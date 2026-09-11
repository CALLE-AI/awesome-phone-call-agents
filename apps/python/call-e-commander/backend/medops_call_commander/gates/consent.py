import logging
from typing import Protocol

from ..core.enums import ConsentStatus
from ..core.exceptions import ConsentDenied

logger = logging.getLogger(__name__)


class ConsentSource(Protocol):
    """Any EHR adapter satisfies this protocol via get_consent_status."""
    def get_consent_status(self, patient_id: str, call_type: str) -> str:
        ...


CALL_TYPE_MAP: dict[str, str] = {
    "patient": "appointment",
    "billing": "billing",
    "lending": "lending",
}


class ConsentGate:
    """
    Checks patient communication consent before any CallPlan can be dispatched.
    UNKNOWN and DENIED both hard-stop the call — no exceptions.
    California two-party consent: outbound calls require prior express consent.
    TCPA: automated calls to mobile numbers require written consent.
    If consent source is unreachable, defaults to UNKNOWN — call does not proceed.
    """

    def __init__(self, source: ConsentSource) -> None:
        self._source = source

    def check(self, patient_id: str, agent_type: str) -> ConsentStatus:
        """
        Returns ConsentStatus.GRANTED only if consent is confirmed.
        Raises ConsentDenied on DENIED or UNKNOWN — caller must not dispatch.
        """
        call_type = CALL_TYPE_MAP.get(agent_type, "appointment")
        raw = self._source.get_consent_status(patient_id, call_type)
        status = ConsentStatus(raw) if raw in ConsentStatus._value2member_map_ else ConsentStatus.UNKNOWN

        if status == ConsentStatus.GRANTED:
            logger.info("Consent GRANTED patient=%s call_type=%s", patient_id, call_type)
            return status

        # DENIED or UNKNOWN — both are hard stops
        logger.warning(
            "Consent %s for patient=%s call_type=%s — call blocked",
            status.value, patient_id, call_type,
        )
        raise ConsentDenied(
            f"Consent {status.value} for patient {patient_id} "
            f"on call_type '{call_type}'. Call will not proceed. "
            f"Manual consent verification required before re-queuing."
        )
