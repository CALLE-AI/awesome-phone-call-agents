from abc import ABC, abstractmethod

from ..core.models import EHREvent


class EHRAdapter(ABC):
    """
    Abstract base for all EHR source adapters.
    Implementors must normalize raw webhook payloads to EHREvent
    and write structured call outcomes back to the source EHR.
    No adapter may log patient_phone or raw payloads.
    """

    @abstractmethod
    def normalize_event(self, raw: dict) -> EHREvent:
        """
        Convert a raw EHR webhook payload into a normalized EHREvent.
        Strip all fields not required by the supervisor.
        patient_phone must be in E.164 format.
        Raw payload must not be retained after this call returns.
        """
        ...

    @abstractmethod
    def write_result(self, patient_id: str, result: dict) -> bool:
        """
        Write structured call outcome back to the EHR.
        result must contain only non-PHI outcome fields:
        e.g. {outcome, promise_date, reschedule_confirmed}.
        No transcript content, phone numbers, or names.
        Returns True on success, False on recoverable failure.
        Raises EHRAdapterError on unrecoverable failure.
        """
        ...

    @abstractmethod
    def get_consent_status(self, patient_id: str, call_type: str) -> str:
        """
        Query the EHR for patient communication consent.
        call_type: "appointment" | "billing" | "lending"
        Returns: "GRANTED" | "DENIED" | "UNKNOWN"
        """
        ...
