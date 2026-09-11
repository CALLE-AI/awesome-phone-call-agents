import logging
import os

import requests

from ..core.exceptions import EHRAdapterError
from ..core.models import EHREvent
from .base import EHRAdapter

logger = logging.getLogger(__name__)

# FHIR R4 resource type to internal event type
FHIR_EVENT_MAP: dict[str, str] = {
    "Appointment:missed":       "missed_appointment",
    "Invoice:overdue-30":       "invoice_30_days",
    "Invoice:overdue-60":       "invoice_60_days",
    "Invoice:overdue-90":       "invoice_90_days",
    "ServiceRequest:loan":      "loan_inquiry_submitted",
}


class FHIRAdapter(EHRAdapter):
    """
    FHIR R4 fallback adapter.
    Accepts any FHIR-compliant EHR webhook that sends standard R4 resources.
    Normalizes to EHREvent using FHIR resource fields.
    Writes outcomes back as FHIR Communication resources.
    """

    def __init__(self) -> None:
        self._base_url = os.environ["FHIR_BASE_URL"]   # e.g. https://fhir.your-ehr.com/r4
        self._token    = os.environ["FHIR_BEARER_TOKEN"]
        self._headers  = {
            "Authorization": f"Bearer {self._token}",
            "Content-Type":  "application/fhir+json",
        }

    def normalize_event(self, raw: dict) -> EHREvent:
        try:
            resource_type = raw.get("resourceType", "")
            status        = raw.get("status", "")
            fhir_key      = f"{resource_type}:{status}"
            event_type    = FHIR_EVENT_MAP.get(fhir_key)

            if not event_type:
                raise EHRAdapterError(f"Unmapped FHIR resource: {fhir_key}")

            patient_ref = (
                raw.get("subject", {}).get("reference")
                or raw.get("patient", {}).get("reference", "")
            )
            patient_id  = patient_ref.split("/")[-1] if "/" in patient_ref else patient_ref
            phone       = self._fetch_patient_phone(patient_id)
            priority    = "urgent" if "90" in status else "routine"

            context = {
                "reference_id": raw.get("id", patient_id),
                "due_date":     raw.get("date"),
                "resource_type": resource_type,
            }

            return EHREvent(
                event_type=event_type,
                patient_id=patient_id,
                patient_phone=phone,
                context=context,
                priority=priority,
                source_system="fhir_r4",
            )
        except KeyError as exc:
            raise EHRAdapterError(f"Missing FHIR field: {exc}") from exc
        finally:
            raw.clear()

    def write_result(self, patient_id: str, result: dict) -> bool:
        """
        Writes a FHIR Communication resource with the structured call outcome.
        No PHI, no transcript content.
        """
        allowed_keys = {"outcome", "promise_date", "reschedule_confirmed", "call_type"}
        safe_result  = {k: v for k, v in result.items() if k in allowed_keys}

        communication = {
            "resourceType": "Communication",
            "status": "completed",
            "subject": {"reference": f"Patient/{patient_id}"},
            "payload": [{"contentString": str(safe_result)}],
            "extension": [{"url": "source", "valueString": "medops_call_commander"}],
        }
        try:
            resp = requests.post(
                f"{self._base_url}/Communication",
                json=communication,
                headers=self._headers,
                timeout=10,
            )
            resp.raise_for_status()
            return True
        except requests.HTTPError as exc:
            raise EHRAdapterError(f"FHIR write_result failed: {exc}") from exc
        except requests.RequestException as exc:
            logger.warning("FHIR write_result network error: %s", exc)
            return False

    def get_consent_status(self, patient_id: str, call_type: str) -> str:
        try:
            resp = requests.get(
                f"{self._base_url}/Consent",
                params={"patient": patient_id, "category": call_type},
                headers=self._headers,
                timeout=10,
            )
            resp.raise_for_status()
            bundle = resp.json()
            entries = bundle.get("entry", [])
            if not entries:
                return "UNKNOWN"
            status = entries[0].get("resource", {}).get("status", "unknown")
            return "GRANTED" if status == "active" else "DENIED"
        except requests.RequestException:
            return "UNKNOWN"

    def _fetch_patient_phone(self, patient_id: str) -> str:
        resp = requests.get(
            f"{self._base_url}/Patient/{patient_id}",
            headers=self._headers,
            timeout=10,
        )
        resp.raise_for_status()
        data    = resp.json()
        telecoms = data.get("telecom", [])
        for t in telecoms:
            if t.get("system") == "phone" and t.get("value"):
                return self._to_e164(t["value"])
        raise EHRAdapterError(f"No phone found in FHIR Patient/{patient_id}")

    @staticmethod
    def _to_e164(phone: str) -> str:
        digits = "".join(c for c in phone if c.isdigit())
        if len(digits) == 10:
            return f"+1{digits}"
        if len(digits) == 11 and digits.startswith("1"):
            return f"+{digits}"
        raise EHRAdapterError(f"Cannot normalize phone to E.164: {phone!r}")
