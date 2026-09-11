"""
OpenDental REST API Adapter
============================
Interfaces with the Open Dental API (https://api.opendental.com/api/v1).

Auth scheme:
    Authorization: ODFHIR {DeveloperKey}/{CustomerKey}

Required API permissions (minimum for production):
    • Read All  (Free) — Patients GET, PatFields GET

No paid permissions are required. Call outcomes are recorded in the MedOps
internal audit log (GET /api/audit) rather than written back to OpenDental.
This keeps the per-practice OpenDental cost at $0.

If you later want call results to appear in OpenDental patient records,
you can upgrade to the Comm permission ($15/location/month) and re-enable
the Commlogs POST write-back in write_result().

Real endpoint mapping:
    get_consent_status   → GET /patfields?PatNum={id}  (Read All, Free)
                           Checks for a PatField named MEDOPS_CALL_CONSENT = "Y"
    _fetch_patient_phone → GET /patients/{PatNum}      (Read All, Free)
    write_result         → internal audit log only     (no OD API call)

Reference: https://opendental.com/site/apispecification.html
"""

import logging
import os

import requests

from ..core.exceptions import EHRAdapterError
from ..core.models import EHREvent
from .base import EHRAdapter

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# OpenDental webhook action → internal event type
# ---------------------------------------------------------------------------
OD_EVENT_MAP: dict[str, str] = {
    "AppointmentMissed":  "missed_appointment",
    "InvoiceOverdue30":   "invoice_30_days",
    "InvoiceOverdue60":   "invoice_60_days",
    "InvoiceOverdue90":   "invoice_90_days",
    "LoanInquiryCreated": "loan_inquiry_submitted",
}

# Name of the PatField that stores TCPA/automated-call consent.
# Must be created in Open Dental: Tools > Patient Field Defs > Add
# Set value to "Y" for consenting patients, leave blank or "N" for non-consenting.
CONSENT_FIELD_NAME = os.environ.get("OPENDENTAL_CONSENT_FIELD", "MEDOPS_CALL_CONSENT")


class OpenDentalAdapter(EHRAdapter):
    """
    Adapter for the Open Dental REST API.

    Required env vars:
        OPENDENTAL_API_URL          Always https://api.opendental.com/api/v1
        OPENDENTAL_DEVELOPER_KEY    Issued by Open Dental (email vendor.relations@opendental.com)
        OPENDENTAL_CUSTOMER_KEY     Per-practice key from Developer Portal
        OPENDENTAL_CONSENT_FIELD    (optional) PatField name storing consent (default: MEDOPS_CALL_CONSENT)
    """

    def __init__(self) -> None:
        self._base_url    = os.environ["OPENDENTAL_API_URL"].rstrip("/")
        developer_key = os.environ["OPENDENTAL_DEVELOPER_KEY"]
        customer_key  = os.environ.get("OPENDENTAL_CUSTOMER_KEY", "").strip()

        # Production:  ODFHIR {DeveloperKey}/{CustomerKey}
        # Demo office: ODFHIR {SingleKey}  (no slash, no customer key)
        if customer_key:
            auth_value = f"ODFHIR {developer_key}/{customer_key}"
        else:
            auth_value = f"ODFHIR {developer_key}"

        self._headers = {
            "Authorization": auth_value,
            "Content-Type":  "application/json",
        }

    # ------------------------------------------------------------------
    # EHRAdapter protocol
    # ------------------------------------------------------------------

    def normalize_event(self, raw: dict) -> EHREvent:
        """
        Normalize an OpenDental webhook payload into an EHREvent.
        The raw dict is cleared after processing (no PHI retained in memory).
        """
        try:
            action     = raw["action"]
            event_type = OD_EVENT_MAP.get(action)
            if not event_type:
                raise EHRAdapterError(f"Unknown OpenDental action: {action!r}")

            patient_id = str(raw["patNum"])
            phone      = self._fetch_patient_phone(patient_id)
            priority   = "urgent" if "90" in action else "routine"

            context = {
                "reference_id":     str(raw.get("referenceId") or raw.get("appointmentId") or patient_id),
                "due_days":         raw.get("overdueDays"),
                "appointment_date": raw.get("appointmentDate"),
            }

            return EHREvent(
                event_type=event_type,
                patient_id=patient_id,
                patient_phone=phone,
                context=context,
                priority=priority,
                source_system="opendental",
            )
        except KeyError as exc:
            raise EHRAdapterError(f"Missing required field in OpenDental payload: {exc}") from exc
        finally:
            raw.clear()  # never retain raw PHI

    def write_result(self, patient_id: str, result: dict) -> bool:
        """
        Record call outcome to the MedOps internal audit log.

        No OpenDental API call is made here — this keeps the required
        OpenDental permission at Read All (Free, $0/location).

        The full call outcome is already stored in:
          • The MedOps audit log  — GET /api/audit
          • The completed CallPlan — GET /api/plans

        If you want outcomes to appear inside OpenDental patient records,
        upgrade to the Comm permission ($15/location) and replace this
        method body with a POST /commlogs call.
        """
        allowed_keys = {"outcome", "promise_date", "reschedule_confirmed", "call_type"}
        safe_result  = {k: v for k, v in result.items() if k in allowed_keys}
        logger.info(
            "[OpenDentalAdapter] Call outcome recorded internally for patient %s: %s",
            patient_id,
            safe_result,
        )
        return True

    def get_consent_status(self, patient_id: str, call_type: str) -> str:
        """
        Check automated call consent via PatFields (Read All permission).

        Looks for a PatField named MEDOPS_CALL_CONSENT (configurable via
        OPENDENTAL_CONSENT_FIELD env var). Returns "GRANTED" only if the
        field value is exactly "Y". Anything else — missing field, blank,
        "N", network error — returns "UNKNOWN" and the ConsentGate blocks
        the call.

        Set MEDOPS_CONSENT_BYPASS=1 in .envrc to skip this check during
        demo/testing against the OpenDental demo office (which has no
        consent fields). Never set this in production.

        Setup in a real Open Dental instance:
            1. Go to Setup > Patient Field Defs > Add
            2. Name the field exactly: MEDOPS_CALL_CONSENT
            3. For each consenting patient, open their chart, go to the
               Patient Fields tab, and set this field to "Y"
        """
        if os.environ.get("MEDOPS_CONSENT_BYPASS") == "1":
            logger.warning(
                "MEDOPS_CONSENT_BYPASS=1: skipping consent check for patient %s — "
                "NEVER set this in production.",
                patient_id,
            )
            return "GRANTED"

        try:
            resp = requests.get(
                f"{self._base_url}/patfields",
                params={"PatNum": patient_id},
                headers=self._headers,
                timeout=10,
            )
            resp.raise_for_status()
            fields = resp.json()

            # fields is a list of {"PatFieldNum":…, "PatNum":…, "FieldName":…, "FieldValue":…}
            for field in fields:
                if field.get("FieldName") == CONSENT_FIELD_NAME:
                    value = str(field.get("FieldValue", "")).strip().upper()
                    if value == "Y":
                        return "GRANTED"
                    return "DENIED"

            # Field not found — treat as no consent on file
            logger.info(
                "Consent field '%s' not found for patient %s — UNKNOWN",
                CONSENT_FIELD_NAME, patient_id,
            )
            return "UNKNOWN"

        except requests.HTTPError as exc:
            logger.warning(
                "OpenDental PatFields GET error %s for patient %s: %s",
                exc.response.status_code, patient_id, exc.response.text,
            )
            return "UNKNOWN"
        except requests.RequestException as exc:
            logger.warning("OpenDental consent check network error: %s", exc)
            return "UNKNOWN"

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _fetch_patient_phone(self, patient_id: str) -> str:
        """
        Fetch patient phone from GET /patients/{PatNum} (Read All).
        Prefers WirelessPhone, then HmPhone, then WkPhone.
        """
        resp = requests.get(
            f"{self._base_url}/patients/{patient_id}",
            headers=self._headers,
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()

        # Prefer mobile (TCPA written consent most commonly covers wireless)
        phone = (
            data.get("WirelessPhone")
            or data.get("HmPhone")
            or data.get("WkPhone")
            or ""
        )
        if not phone:
            raise EHRAdapterError(
                f"No phone number found in OpenDental Patient/{patient_id}. "
                f"Check WirelessPhone, HmPhone, WkPhone fields."
            )
        return self._to_e164(phone)

    @staticmethod
    def _to_e164(phone: str) -> str:
        """Normalize a US phone number to E.164 format."""
        digits = "".join(c for c in phone if c.isdigit())
        if len(digits) == 10:
            return f"+1{digits}"
        if len(digits) == 11 and digits.startswith("1"):
            return f"+{digits}"
        raise EHRAdapterError(
            f"Cannot normalize phone to E.164: {phone!r}. "
            f"Expected 10-digit US number."
        )
