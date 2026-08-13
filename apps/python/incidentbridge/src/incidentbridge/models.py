"""Validated input model for one authorized vendor-support call."""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from typing import Any

E164 = re.compile(r"^\+[1-9]\d{7,14}$")
SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$")
LOCALE = re.compile(r"^[a-z]{2,3}(?:-[A-Z]{2})?$")
REGION = re.compile(r"^[A-Z]{2}$")
PHONE_LIKE = re.compile(r"(?<!\w)\+?[1-9]\d{7,14}(?!\w)")
EMAIL_LIKE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
SECRET_LIKE = re.compile(
    r"(?i)\b(api[_ -]?key|access[_ -]?token|password|private[_ -]?key|"
    r"client[_ -]?secret|credential|bearer)\b"
)


@dataclass(frozen=True)
class IncidentRequest:
    workflow_id: str
    incident_id: str
    support_phone: str
    authorized_support_contact: bool
    caller_business_name: str
    provider_name: str
    affected_service: str
    incident_summary: str
    severity: str
    observed_at_utc: str
    region: str
    locale: str

    def public_dict(self) -> dict[str, Any]:
        return asdict(self)


def clean_text(value: Any, field: str, minimum: int, maximum: int) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string")
    cleaned = " ".join(value.split())
    if not minimum <= len(cleaned) <= maximum:
        raise ValueError(f"{field} must contain {minimum}-{maximum} characters")
    return cleaned


def clean_task_text(value: Any, field: str, minimum: int, maximum: int) -> str:
    cleaned = clean_text(value, field, minimum, maximum)
    if SECRET_LIKE.search(cleaned) or PHONE_LIKE.search(cleaned) or EMAIL_LIKE.search(cleaned):
        raise ValueError(
            f"{field} appears to contain credentials, secrets, or personal contact data"
        )
    return cleaned


def parse_utc(value: Any) -> str:
    text = clean_text(value, "observed_at_utc", 20, 35)
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("observed_at_utc must be an ISO-8601 timestamp") from exc
    if parsed.utcoffset() != UTC.utcoffset(parsed):
        raise ValueError("observed_at_utc must use UTC")
    return parsed.astimezone(UTC).isoformat().replace("+00:00", "Z")


def parse_request(raw: Any) -> IncidentRequest:
    if not isinstance(raw, dict):
        raise ValueError("request must be a JSON object")

    workflow_id = clean_text(raw.get("workflow_id"), "workflow_id", 3, 64)
    incident_id = clean_text(raw.get("incident_id"), "incident_id", 3, 64)
    if not SAFE_ID.fullmatch(workflow_id):
        raise ValueError("workflow_id contains unsupported characters")
    if not SAFE_ID.fullmatch(incident_id):
        raise ValueError("incident_id contains unsupported characters")

    support_phone = clean_text(raw.get("support_phone"), "support_phone", 8, 16)
    if not E164.fullmatch(support_phone):
        raise ValueError("support_phone must use E.164 format")
    if raw.get("authorized_support_contact") is not True:
        raise ValueError("authorized_support_contact must be true")

    summary = clean_task_text(raw.get("incident_summary"), "incident_summary", 12, 500)

    severity = raw.get("severity")
    if severity not in {"degraded", "outage"}:
        raise ValueError("severity must be degraded or outage")

    region = clean_text(raw.get("region"), "region", 2, 2)
    if not REGION.fullmatch(region):
        raise ValueError("region must be a two-letter uppercase country code")
    locale = clean_text(raw.get("locale", "en-US"), "locale", 2, 16)
    if not LOCALE.fullmatch(locale):
        raise ValueError("locale must look like en-US")

    return IncidentRequest(
        workflow_id=workflow_id,
        incident_id=incident_id,
        support_phone=support_phone,
        authorized_support_contact=True,
        caller_business_name=clean_task_text(
            raw.get("caller_business_name"), "caller_business_name", 2, 80
        ),
        provider_name=clean_task_text(raw.get("provider_name"), "provider_name", 2, 80),
        affected_service=clean_task_text(raw.get("affected_service"), "affected_service", 2, 100),
        incident_summary=summary,
        severity=severity,
        observed_at_utc=parse_utc(raw.get("observed_at_utc")),
        region=region,
        locale=locale,
    )


def mask_phone(phone: str) -> str:
    visible = 3
    return f"{phone[:visible]}{'*' * max(4, len(phone) - visible - 3)}{phone[-3:]}"
