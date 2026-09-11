from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any
from uuid import uuid4

from app.config import settings
from app.models.orm import DiseaseProtocol, FollowUp, Patient
from app.utils.validators import (
    OFFICIAL_CALLE_ORIGIN,
    UntrustedCalleOrigin,
    is_supported_e164,
    validate_official_calle_origin,
)
from calle import CalleClient

FOLLOWUP_RESULT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": [
        "feeling_overall",
        "pain_level",
        "medication_compliance",
        "emergency_symptoms_reported",
        "notes",
    ],
    "properties": {
        "feeling_overall": {
            "type": "string",
            "description": "How the patient says they feel overall.",
            "enum": ["better", "same", "worse", "unknown"],
        },
        "pain_level": {
            "type": "string",
            "description": "How much pain the patient is experiencing, on a scale of 0 to 10",
            "minimum": 0,
            "maximum": 10,
        },
        "medication_compliance": {
            "type": "string",
            "description": "Whether the patient is taking their medications as prescribed",
            "enum": ["yes", "partial", "no", "unknown"],
        },
        "emergency_symptoms_reported": {
            "type": "boolean",
            "description": (
                "True if the patient reports emergency symptoms such as chest pain, "
                "severe shortness of breath, or confusion."
            ),
        },
        "notes": {
            "type": "string",
            "description": "Short clinical notes from the conversation.",
        },
    },
}


@dataclass
class CallEResult:
    provider_call_id: str | None
    status: str
    dry_run: bool
    raw_response: dict[str, Any] = field(default_factory=dict)


class CalleCreateUnknownError(Exception):
    """CALL-E create was sent; whether a call exists is unknown. Do not redial."""


def _sdk_create_error_types() -> tuple[
    tuple[type[BaseException], ...],
    tuple[type[BaseException], ...],
    tuple[type[BaseException], ...],
    tuple[type[BaseException], ...],
    tuple[type[BaseException], ...],
]:
    timeout_types: tuple[type[BaseException], ...] = (TimeoutError,)
    connection_types: tuple[type[BaseException], ...] = (ConnectionError, OSError)
    api_types: tuple[type[BaseException], ...] = ()
    auth_types: tuple[type[BaseException], ...] = ()
    rate_types: tuple[type[BaseException], ...] = ()
    try:
        from calle import (
            CalleAPIError,
            CalleAuthenticationError,
            CalleConnectionError,
            CalleRateLimitError,
            CalleTimeoutError,
        )
    except ImportError:
        return timeout_types, connection_types, api_types, auth_types, rate_types
    return (
        (*timeout_types, CalleTimeoutError),
        (*connection_types, CalleConnectionError),
        (CalleAPIError,),
        (CalleAuthenticationError,),
        (CalleRateLimitError,),
    )


def _http_status(exc: BaseException) -> int | None:
    for attr in ("status_code", "status", "http_status"):
        value = getattr(exc, attr, None)
        if isinstance(value, int):
            return value
    return None


def _is_ambiguous_create_error(exc: BaseException) -> bool:
    if isinstance(exc, CalleCreateUnknownError):
        return True
    timeout_types, connection_types, api_types, auth_types, rate_types = (
        _sdk_create_error_types()
    )
    if isinstance(
        exc, (json.JSONDecodeError, UnicodeError, RecursionError, EOFError)
    ):
        return True
    if isinstance(exc, timeout_types):
        return True
    if isinstance(exc, connection_types):
        return True
    if auth_types and isinstance(exc, auth_types):
        return False
    if rate_types and isinstance(exc, rate_types):
        return False
    status = _http_status(exc)
    if status is not None:
        if status >= 500 or status == 408:
            return True
        if 400 <= status < 500:
            return False
    if api_types and isinstance(exc, api_types):
        return True
    return True


def _create_call(client: Any, **kwargs: Any) -> dict[str, Any]:
    try:
        response = client.calls.create(**kwargs)
    except Exception as exc:
        if _is_ambiguous_create_error(exc):
            raise CalleCreateUnknownError(
                "CALL-E create outcome is unknown"
            ) from exc
        raise
    try:
        payload = _as_call_dict(response)
    except ValueError as exc:
        raise CalleCreateUnknownError(
            "CALL-E create returned an unreadable payload"
        ) from exc
    provider_id = str(payload.get("id") or "").strip()
    if not provider_id:
        raise CalleCreateUnknownError(
            "CALL-E create returned no call id"
        )
    return payload


def pinned_calle_base_url() -> str:
    raw = (settings.calle_base_url or "").strip() or OFFICIAL_CALLE_ORIGIN
    return validate_official_calle_origin(raw)


def _get_client() -> CalleClient:
    return CalleClient(
        api_key=settings.calle_api_key,
        base_url=pinned_calle_base_url(),
    )


def _infer_region(phone: str) -> str:
    if phone.startswith("+91"):
        return "IN"
    if phone.startswith("+1"):
        return "US"
    return "IN"


def place_call(
    patient: Patient,
    followup: FollowUp | None = None,
    *,
    task: str, 
    result_schema: dict[str, Any],
    protocol: DiseaseProtocol | None = None,
    dry_run: bool | None = None,
    internal_call_id: int | None = None,
    webhook_url: str | None = None,
) -> CallEResult:
    """Place a CALL-E follow up call for a patient."""
    if dry_run is None:
        dry_run = settings.dry_run_default

    if not patient.consent_on_file and not dry_run:
        raise ValueError("Patient has not given consent to be called")
    if not dry_run and not is_supported_e164(patient.phone):
        raise ValueError("patient phone is not a supported ASCII E.164 number")

    metadata = {
        "purpose": "post_discharge_followup",
        "patient_id": str(patient.id),
        "followup_id": str(followup.id) if followup else None,
        "internal_call_id": str(internal_call_id) if internal_call_id else None,
        "protocol_id": str(protocol.id) if protocol else None,
        "protocol_code": protocol.code if protocol else None,
    }

    if dry_run:
        fake_id = f"dryrun_{uuid4().hex[:12]}"
        return CallEResult(
            provider_call_id=fake_id,
            status="dry_run",
            dry_run=True,
            raw_response={
                "id": fake_id,
                "status": "dry_run",
                "metadata": metadata,
                "task": task,
                "result_schema": result_schema,
                "message": "Dry run only — no CALL-E request was sent.",
            },
        )

    resolved_webhook = webhook_url or settings.calle_webhook_url

    client = _get_client()
    response = _create_call(
        client,
        task=task,
        recipients=[
            {
                "phones": [patient.phone],
                "region": _infer_region(patient.phone),
                "locale": "en-IN" if patient.phone.startswith("+91") else "en-US",
            }
        ],
        result_schema=result_schema,
        metadata=metadata,
        webhook_url=resolved_webhook,
        idempotency_key=(
            f"followup-{followup.id}-{internal_call_id}"
            if followup and internal_call_id
            else f"patient-{patient.id}-{uuid4().hex[:8]}"
        ),
    )

    return CallEResult(
        provider_call_id=str(response["id"]) if response.get("id") else None,
        status=str(response.get("status", "queued")),
        dry_run=False,
        raw_response=response,
    )


DOCTOR_WARNING_RESULT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["acknowledged", "will_follow_up", "notes"],
    "properties": {
        "acknowledged": {
            "type": "boolean",
            "description": "Whether the doctor confirmed they received the emergency alert.",
        },
        "will_follow_up": {
            "type": "boolean",
            "description": "Whether the doctor said they will contact or follow up with the patient.",
        },
        "notes": {
            "type": "string",
            "description": "Short notes from the doctor about next steps.",
        },
    },
}


def place_warning_call(
    *,
    doctor_phone: str,
    task: str,
    patient: Patient,
    internal_call_id: int,
    dry_run: bool | None = None,
    webhook_url: str | None = None,
) -> CallEResult:
    """Place a CALL-E warning call to the patient's doctor."""
    if dry_run is None:
        dry_run = settings.dry_run_default

    if not dry_run and not is_supported_e164(doctor_phone):
        raise ValueError("doctor phone is not a supported ASCII E.164 number")

    metadata = {
        "purpose": "doctor_warning",
        "patient_id": str(patient.id),
        "internal_call_id": str(internal_call_id),
    }

    if dry_run:
        fake_id = f"dryrun_doc_{uuid4().hex[:12]}"
        return CallEResult(
            provider_call_id=fake_id,
            status="dry_run",
            dry_run=True,
            raw_response={
                "id": fake_id,
                "status": "dry_run",
                "metadata": metadata,
                "task": task,
                "message": "Dry run only — no CALL-E doctor warning call was sent.",
            },
        )

    resolved_webhook = webhook_url or settings.calle_webhook_url
    client = _get_client()
    response = _create_call(
        client,
        task=task,
        recipients=[
            {
                "phones": [doctor_phone],
                "region": _infer_region(doctor_phone),
                "locale": "en-IN" if doctor_phone.startswith("+91") else "en-US",
            }
        ],
        result_schema=DOCTOR_WARNING_RESULT_SCHEMA,
        metadata=metadata,
        webhook_url=resolved_webhook,
        idempotency_key=f"doctor-warning-{internal_call_id}",
    )

    return CallEResult(
        provider_call_id=str(response["id"]),
        status=str(response.get("status", "queued")),
        dry_run=False,
        raw_response=response,
    )


def _as_call_dict(snapshot: Any) -> dict[str, Any]:
    if isinstance(snapshot, dict):
        return snapshot
    if hasattr(snapshot, "model_dump"):
        dumped = snapshot.model_dump()
        if isinstance(dumped, dict):
            return dumped
    if hasattr(snapshot, "dict"):
        dumped = snapshot.dict()
        if isinstance(dumped, dict):
            return dumped
    raise ValueError("CALL-E calls.get returned a non-object payload")


def fetch_call(provider_call_id: str) -> dict[str, Any]:
    """Load the authoritative terminal snapshot from the pinned CALL-E API."""
    client = _get_client()
    snapshot = _as_call_dict(client.calls.get(provider_call_id))
    snapshot_id = str(snapshot.get("id") or "")
    if snapshot_id != str(provider_call_id):
        raise ValueError("CALL-E calls.get id did not match the provider call id")
    return snapshot


def event_id_from_headers(headers: dict[str, str]) -> str:
    for key, value in headers.items():
        if key.lower() == "call-e-event-id":
            return (value or "").strip()
    return ""


__all__ = [
    "OFFICIAL_CALLE_ORIGIN",
    "CallEResult",
    "CalleCreateUnknownError",
    "UntrustedCalleOrigin",
    "event_id_from_headers",
    "fetch_call",
    "pinned_calle_base_url",
    "place_call",
    "place_warning_call",
    "validate_official_calle_origin",
]
