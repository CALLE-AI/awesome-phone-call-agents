"""CALL-E task, strict result schema, redaction, and fail-closed routing."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import asdict
from typing import Any

from incidentbridge.models import IncidentRequest, mask_phone

PHONE_LIKE = re.compile(r"(?<!\w)\+?[1-9]\d{7,14}(?!\w)")
EMAIL_LIKE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
TOKEN_LIKE = re.compile(r"(?i)(bearer|token|api[_ -]?key)\s*[:=]?\s*\S+")
TERMINAL_SUCCESS = {"completed", "succeeded"}
MIN_CONFIDENCE = 0.8


def result_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "required": [
            "right_support_desk",
            "continued_after_ai_disclosure",
            "incident_acknowledged",
            "ticket_id",
            "vendor_status",
            "eta_minutes",
            "workaround_available",
            "workaround_summary",
            "callback_window",
            "human_escalation_required",
            "evidence_summary",
        ],
        "properties": {
            "right_support_desk": {"type": "string", "enum": ["yes", "no", "unknown"]},
            "continued_after_ai_disclosure": {
                "type": "string",
                "enum": ["yes", "no", "unknown"],
            },
            "incident_acknowledged": {
                "type": "string",
                "enum": ["yes", "no", "unknown"],
            },
            "ticket_id": {"type": "string", "maxLength": 80},
            "vendor_status": {
                "type": "string",
                "enum": ["investigating", "identified", "monitoring", "resolved", "unknown"],
            },
            "eta_minutes": {"type": ["integer", "null"], "minimum": 0, "maximum": 10080},
            "workaround_available": {
                "type": "string",
                "enum": ["yes", "no", "unknown"],
            },
            "workaround_summary": {"type": "string", "maxLength": 300},
            "callback_window": {"type": "string", "maxLength": 120},
            "human_escalation_required": {
                "type": "string",
                "enum": ["yes", "no", "unknown"],
            },
            "evidence_summary": {"type": "string", "maxLength": 500},
        },
        "additionalProperties": False,
    }


def build_task(request: IncidentRequest) -> str:
    return (
        f"Call the authorized business support contact for {request.provider_name} on behalf "
        f"of {request.caller_business_name}. Identify yourself as an AI calling assistant and "
        "ask whether this is the correct support desk and whether they consent to continue. If "
        "either answer is not clearly yes, disclose no incident details and end the call. Never "
        "request or reveal credentials, authentication codes, customer data, personal data, "
        "payment information, or contract terms. "
        f"After consent, reference incident {request.incident_id}. The affected service is "
        f"{request.affected_service}; severity is {request.severity}; it was observed at "
        f"{request.observed_at_utc}. Non-sensitive summary: "
        f"{request.incident_summary.rstrip('. ')}. Ask "
        "whether the vendor acknowledges the incident, request a support ticket identifier, "
        "current status, estimated time in minutes if known, a safe operational workaround if "
        "available, and a callback window. Read back the captured facts once. Do not accept new "
        "commercial terms, authorize changes, claim the service is restored, close the incident, "
        "or schedule another call. If the support contact requests a human, mark human escalation."
    )


def call_arguments(request: IncidentRequest) -> dict[str, Any]:
    return {
        "task": build_task(request),
        "recipients": [
            {
                "phones": [request.support_phone],
                "region": request.region,
                "locale": request.locale,
            }
        ],
        "result_schema": result_schema(),
        "metadata": {
            "workflow_id": request.workflow_id,
            "workflow_type": "vendor_incident_support",
            "incident_id": request.incident_id,
        },
    }


def idempotency_key(request: IncidentRequest) -> str:
    canonical = json.dumps(
        call_arguments(request), ensure_ascii=False, separators=(",", ":"), sort_keys=True
    ).encode()
    return f"incidentbridge-{hashlib.sha256(canonical).hexdigest()}"


def confidence_score(value: Any) -> float:
    if isinstance(value, bool):
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, dict):
        score = value.get("score")
        if isinstance(score, (int, float)) and not isinstance(score, bool):
            return float(score)
    return 0.0


def valid_result(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    schema = result_schema()
    required = schema["required"]
    if set(value) != set(required):
        return False
    for field in required:
        field_value = value[field]
        rule = schema["properties"][field]
        if field == "eta_minutes":
            if field_value is not None and (
                isinstance(field_value, bool)
                or not isinstance(field_value, int)
                or not 0 <= field_value <= 10080
            ):
                return False
            continue
        if not isinstance(field_value, str) or len(field_value) > rule.get("maxLength", 10_000):
            return False
        if "enum" in rule and field_value not in rule["enum"]:
            return False
    return True


def route_result(
    structured: dict[str, Any] | None,
    *,
    provider_status: str = "completed",
    task_completed: bool = True,
    completion_confidence: Any = 1.0,
) -> dict[str, str]:
    if (
        provider_status not in TERMINAL_SUCCESS
        or task_completed is not True
        or confidence_score(completion_confidence) < MIN_CONFIDENCE
    ):
        return {
            "route": "needs_human",
            "reason": "CALL-E did not return a reliable terminal success result.",
            "incident_closed": "false",
        }
    if not valid_result(structured):
        return {
            "route": "needs_human",
            "reason": "CALL-E did not return the complete required result schema.",
            "incident_closed": "false",
        }
    assert structured is not None
    if (
        structured["right_support_desk"] != "yes"
        or structured["continued_after_ai_disclosure"] != "yes"
    ):
        return {
            "route": "needs_human",
            "reason": "The correct support desk did not consent to the incident discussion.",
            "incident_closed": "false",
        }
    if structured["human_escalation_required"] != "no":
        return {
            "route": "needs_human",
            "reason": "The call result requires human escalation.",
            "incident_closed": "false",
        }
    if structured["incident_acknowledged"] == "yes" and structured["ticket_id"] != "unknown":
        return {
            "route": "vendor_acknowledged",
            "reason": "The vendor acknowledged the incident and supplied a ticket identifier.",
            "incident_closed": "false",
        }
    return {
        "route": "needs_human",
        "reason": "The vendor did not provide an acknowledged, ticketed incident outcome.",
        "incident_closed": "false",
    }


def redact(value: Any) -> Any:
    if isinstance(value, str):
        value = PHONE_LIKE.sub("[phone-redacted]", value)
        value = EMAIL_LIKE.sub("[email-redacted]", value)
        return TOKEN_LIKE.sub("[credential-redacted]", value)
    if isinstance(value, list):
        return [redact(item) for item in value]
    if isinstance(value, dict):
        return {key: redact(item) for key, item in value.items()}
    return value


def preview(request: IncidentRequest) -> dict[str, Any]:
    arguments = call_arguments(request)
    arguments["recipients"] = [
        {
            "phones": [mask_phone(request.support_phone)],
            "region": request.region,
            "locale": request.locale,
        }
    ]
    public_input = asdict(request)
    public_input["support_phone"] = mask_phone(request.support_phone)
    return {
        "mode": "preview",
        "creates_phone_call": False,
        "input": public_input,
        "idempotency_key": idempotency_key(request),
        "call_arguments": arguments,
        "decision_authority": "A human verifies recovery and closes the incident.",
    }


def simulated_result(request: IncidentRequest, scenario: str) -> dict[str, Any]:
    base = {
        "right_support_desk": "yes",
        "continued_after_ai_disclosure": "yes",
        "incident_acknowledged": "yes",
        "ticket_id": "SUP-4821",
        "vendor_status": "investigating",
        "eta_minutes": 45,
        "workaround_available": "yes",
        "workaround_summary": "Use the documented secondary ingestion endpoint.",
        "callback_window": "Within 60 minutes",
        "human_escalation_required": "no",
        "evidence_summary": "Support acknowledged the outage and supplied a ticket and ETA.",
    }
    scenarios = {
        "acknowledged": base,
        "wrong-desk": {
            **base,
            "right_support_desk": "no",
            "continued_after_ai_disclosure": "no",
            "incident_acknowledged": "unknown",
            "ticket_id": "unknown",
            "vendor_status": "unknown",
            "eta_minutes": None,
            "workaround_available": "unknown",
            "workaround_summary": "",
            "callback_window": "unknown",
            "human_escalation_required": "yes",
            "evidence_summary": "The recipient was not the authorized support desk.",
        },
        "eta-unknown": {
            **base,
            "eta_minutes": None,
            "workaround_available": "no",
            "workaround_summary": "",
            "callback_window": "unknown",
        },
    }
    structured = scenarios[scenario]
    return {
        "mode": "simulate",
        "creates_phone_call": False,
        "scenario": scenario,
        "incident_id": request.incident_id,
        "structured_result": structured,
        "decision": route_result(structured),
    }
