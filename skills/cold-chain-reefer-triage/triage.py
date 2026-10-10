"""
Cold Chain Reefer Triage Agent — Standalone Telephony Skill
==========================================================
An advisory voice-telephony triage primitive powered by the CALL-E Python SDK (`calle-ai`).

This module has zero backend or framework dependencies (no FastAPI, LangGraph, or Langfuse)
and is designed for direct submission to `CALLE-AI/awesome-phone-call-agents`.

Operational Safety Guarantees:
1. No-Call Default: Dry-run simulation is active by default (`live=False`). Real outbound calls
   require explicit authorization (`live=True` or `--live` / `--authorize-live-call`).
2. Strict E.164 Enforcement: Rejects invalid or emergency numbers before any request creation.
3. Transport Security: Enforces HTTPS-only base URLs for CALL-E API endpoints.
4. Privacy & Masking: Automatically masks destination phone numbers in logs and output displays.
5. Advisory Scope: Outputs structured recommendations only; does not mutate real-world fleet state.
"""

import copy
import logging
import re
import urllib.parse
from typing import Any, Dict, Literal, Optional, Union
from pydantic import BaseModel, ConfigDict, Field

logger = logging.getLogger("cold_chain_reefer_triage")

# Strict E.164 regex: '+' followed by 1 to 14 digits (2 to 15 chars total)
E164_PATTERN = re.compile(r"^\+[1-9]\d{1,14}$")
EMERGENCY_SHORTCODES = {"911", "112", "999", "000", "110", "119"}


# ==============================================================================
# 1. Validation & Privacy Helpers
# ==============================================================================

def mask_phone(phone: Optional[str]) -> str:
    """Mask phone number for safe logging (e.g. +13035550147 -> +1303***0147)."""
    if not phone:
        return ""
    clean = phone.strip()
    if len(clean) >= 8:
        return f"{clean[:5]}***{clean[-4:]}"
    elif len(clean) >= 4:
        return f"{clean[:2]}***{clean[-2:]}"
    return "***"


def validate_e164_phone(phone: Optional[str]) -> bool:
    """Validate that phone number strictly satisfies E.164 format and is not an emergency shortcode."""
    if not phone or not isinstance(phone, str):
        return False
    clean = phone.strip()
    if not E164_PATTERN.match(clean):
        return False
    # Reject emergency numbers embedded in country codes (e.g. +1911)
    digits = clean.lstrip("+")
    for code in EMERGENCY_SHORTCODES:
        if digits == code or digits.endswith(code) and len(digits) <= 5:
            return False
    return True


def validate_calle_base_url(url: Optional[str]) -> str:
    """Validate that CALL-E API base URL enforces secure HTTPS protocol."""
    target_url = url or "https://api.heycall-e.com"
    parsed = urllib.parse.urlparse(target_url)
    if parsed.scheme.lower() != "https":
        raise ValueError(
            f"Insecure CALLE_BASE_URL '{target_url}': Only secure 'https://' URLs are permitted."
        )
    return target_url


def sanitize_error_message(error_msg: str) -> str:
    """Sanitize raw error messages to avoid leaking API tokens or sensitive headers."""
    # Strip potential Bearer tokens or secret keys
    sanitized = re.sub(r"(Bearer\s+)[A-Za-z0-9_\-\.]{8,}", r"\1[REDACTED]", error_msg)
    sanitized = re.sub(r"(api[_-]?key\s*[:=]\s*)[A-Za-z0-9_\-\.]{8,}", r"\1[REDACTED]", sanitized, flags=re.IGNORECASE)
    return sanitized


# ==============================================================================
# 2. Pydantic V2 Output Schemas
# ==============================================================================

class CallETriageStructuredResult(BaseModel):
    """Structured evidence and remediation intent extracted from driver triage call."""

    model_config = ConfigDict(extra="ignore")

    driver_verified_safe_location: bool = Field(
        ...,
        description="Whether driver confirmed truck is stopped in a safe location (e.g., shoulder, rest stop)",
    )
    reefer_engine_running: bool = Field(
        ...,
        description="Whether the diesel reefer refrigeration unit is actively running/humming",
    )
    air_bulkhead_obstructed: bool = Field(
        ...,
        description="Whether freight or pallets are blocking the front return air bulkhead",
    )
    cargo_sweating_detected: bool = Field(
        ...,
        description="Whether visible moisture, sweating, or condensation was observed on cargo packaging",
    )
    driver_reported_alarm_code: Optional[str] = Field(
        default=None,
        description="Active microprocessor alarm code displayed on unit controller (e.g., 'ALARM 18')",
    )
    driver_hos_minutes_remaining: int = Field(
        ...,
        description="Driver-reported remaining driving hours in minutes under FMCSA 49 CFR Part 395",
    )
    selected_option: Literal[
        "DIVERT_TO_COLD_HUB",
        "CONTINUE_MONITORED",
        "ROADSIDE_SERVICE",
        "DRIVER_REFUSED",
    ] = Field(
        ...,
        description="Remediation option agreed upon with driver during voice triage",
    )
    emergency_reported: bool = Field(
        ...,
        description="Whether driver reported an active physical accident, cargo fire, or road hazard",
    )


class CallERecipient(BaseModel):
    """Target recipient information for CALL-E telephony."""

    model_config = ConfigDict(extra="ignore")

    phone: str = Field(..., description="Recipient phone number in E.164 format")
    region: str = Field("US", description="ISO country code (e.g. 'US', 'IN')")
    locale: str = Field("en-US", description="Language/locale for the call (e.g. 'en-US')")


class CallETriageOutput(BaseModel):
    """Top-level response model from CALL-E reefer triage invocation."""

    model_config = ConfigDict(extra="ignore")

    call_id: Optional[str] = Field(
        default=None,
        description="Unique identifier returned by CALL-E for this telephone call",
    )
    status: str = Field(
        ...,
        description="Call outcome status: completed, busy, no_answer, failed, simulated, or unknown",
    )
    task_completed: bool = Field(
        default=False,
        description="Whether the call completed and produced valid structured extraction",
    )
    completion_confidence: float = Field(
        default=0.0,
        ge=0.0,
        le=1.0,
        description="Confidence score (0.0 to 1.0) of the structured extraction",
    )
    structured_result: Optional[CallETriageStructuredResult] = Field(
        default=None,
        description="Validated structured triage data extracted from call transcript",
    )
    evidence: Dict[str, Any] = Field(
        default_factory=dict,
        description="Evidence dictionary containing transcript, recording references, or simulation metadata",
    )
    error: Optional[str] = Field(
        default=None,
        description="Sanitized error message if the call failed or validation threw an exception",
    )


# ==============================================================================
# 3. Standalone Telephony Execution Primitive
# ==============================================================================

def sanitize_json_schema_for_calle(schema: Dict[str, Any]) -> Dict[str, Any]:
    """Sanitize a JSON Schema dictionary for CALL-E compatibility."""
    clean = copy.deepcopy(schema)
    props = clean.get("properties", {})
    for name, prop in props.items():
        if isinstance(prop, dict) and "anyOf" in prop:
            types = [
                x.get("type")
                for x in prop["anyOf"]
                if isinstance(x, dict) and x.get("type") and x.get("type") != "null"
            ]
            prop["type"] = types[0] if types else "string"
            del prop["anyOf"]
            if prop.get("default") is None:
                prop.pop("default", None)
    return clean


def initiate_reefer_triage(
    driver_phone: str,
    driver_name: str,
    truck_id: str,
    trailer_id: str,
    current_temp_f: float,
    setpoint_temp_f: float,
    nearest_cold_hub_name: str,
    nearest_cold_hub_eta_minutes: int,
    commodity_type: str = "Produce",
    allowed_temp_range_str: str = "33°F to 36°F",
    client: Optional[Any] = None,
    live: bool = False,
) -> CallETriageOutput:
    """
    Initiates reefer voice triage with safe no-call default execution.

    Invocation Rules:
    1. No-Call Default: If live=False (default), runs in dry-run mode and returns a validated simulation
       payload without placing any outbound network calls or consuming telephony credits.
    2. Strict E.164 Validation: Rejects invalid or emergency phone numbers before any call dispatch.
    3. HTTPS Base URL: Validates that CALL-E client target URL enforces secure HTTPS.
    4. Destination Masking: All phone logging uses masked format (e.g. +1303***0147).
    5. Zero-Redial: Exactly 1 call attempt if live=True. Does not redial on drops/refusals.
    """
    masked = mask_phone(driver_phone)

    # 1. Enforce strict E.164 validation
    if not validate_e164_phone(driver_phone):
        logger.warning("[Validation Error] Rejected non-E.164 or emergency destination: %s", masked)
        return CallETriageOutput(
            call_id=None,
            status="failed",
            task_completed=False,
            completion_confidence=0.0,
            structured_result=None,
            evidence={},
            error=f"Invalid E.164 phone format or prohibited emergency number for destination: {masked}",
        )

    # 2. Default Dry-Run / Simulated Mode (No network calls)
    if not live:
        logger.info("[DRY-RUN: No live call placed] Simulating autonomous reefer triage for %s", masked)
        simulated_structured = CallETriageStructuredResult(
            driver_verified_safe_location=True,
            reefer_engine_running=True,
            air_bulkhead_obstructed=False,
            cargo_sweating_detected=False,
            driver_reported_alarm_code="ALARM 18 - HIGH ENGINE TEMP",
            driver_hos_minutes_remaining=45,
            selected_option="DIVERT_TO_COLD_HUB",
            emergency_reported=False,
        )
        return CallETriageOutput(
            call_id="sim-dryrun-reefer-triage-001",
            status="completed",
            task_completed=True,
            completion_confidence=0.95,
            structured_result=simulated_structured,
            evidence={
                "simulation": True,
                "note": "[DRY-RUN: No live call placed] Explicit authorization flag (--live / live=True) required for network call.",
                "target_destination_masked": masked,
                "truck_id": truck_id,
                "trailer_id": trailer_id,
            },
            error=None,
        )

    # 3. Live Authorized Call Execution
    if client is None:
        return CallETriageOutput(
            call_id=None,
            status="failed",
            task_completed=False,
            completion_confidence=0.0,
            structured_result=None,
            evidence={},
            error="Live call authorized but no initialized CalleClient was provided.",
        )

    # Validate HTTPS base URL
    base_url = getattr(client, "base_url", None)
    try:
        validate_calle_base_url(base_url)
    except ValueError as val_err:
        return CallETriageOutput(
            call_id=None,
            status="failed",
            task_completed=False,
            completion_confidence=0.0,
            structured_result=None,
            evidence={},
            error=sanitize_error_message(str(val_err)),
        )

    # Build prompt instructions for CALL-E voice agent
    task_prompt = (
        f"Call {driver_phone} and speak with commercial driver {driver_name} regarding a critical reefer temperature excursion on truck {truck_id}, trailer {trailer_id}.\n\n"
        f"ALERT CONTEXT:\n"
        f"- Cargo Commodity: {commodity_type}\n"
        f"- Required Setpoint: {setpoint_temp_f:.1f}°F (Target Range: {allowed_temp_range_str})\n"
        f"- Current Sensor Reading: {current_temp_f:.1f}°F (EXCURSION DETECTED)\n"
        f"- Nearest Verified Cold Hub: {nearest_cold_hub_name} ({nearest_cold_hub_eta_minutes} min drive)\n\n"
        f"MANDATORY TRIAGE CHECKLIST & QUESTIONS TO ASK DRIVER:\n"
        f"1. SAFETY: Confirm the driver is safely parked or pulled over before continuing.\n"
        f"2. UNIT STATUS: Ask if the diesel reefer refrigeration unit is actively running/humming.\n"
        f"3. AIRFLOW: Ask if the front return air bulkhead is clear or blocked by cargo/pallets.\n"
        f"4. CARGO & COILS: Ask if they see cargo sweating, moisture on packaging, or frost/ice on evaporator coils.\n"
        f"5. ALARM CODE: Ask if any error or alarm codes are shown on the in-cab or reefer controller display.\n"
        f"6. HOURS OF SERVICE: Ask how many remaining driving hours or minutes they have on their electronic logbook (FMCSA HOS).\n"
        f"7. EMERGENCY: Ask if there is any active vehicle accident, cargo fire, or road emergency (if yes, advise dialing 911).\n"
        f"8. REMEDIATION AGREEMENT: Present options: (A) Divert to {nearest_cold_hub_name}, (B) Pull over for roadside service, (C) Continue monitored if unit reset cleared alarm, or (D) Driver refusal. Record their agreed selection.\n\n"
        f"Prohibit DIY repairs, do not discuss freight claims or settlement value. "
        f"On completion, record all driver responses into the structured result. If the call cannot be completed, record the failure reason."
    )

    try:
        derived_region = "IN" if driver_phone.startswith("+91") else "US"
        recipient_data = {
            "phones": [driver_phone],
            "region": derived_region,
            "locale": "en-US",
        }
        clean_schema = sanitize_json_schema_for_calle(
            CallETriageStructuredResult.model_json_schema()
        )

        logger.info("[CALL-E Dispatch] Live authorized call dispatched to %s", masked)
        call_response = client.calls.create_and_wait(
            task=task_prompt,
            recipient=recipient_data,
            recipient_result_schema=clean_schema,
        )

        def get_field(obj: Any, key: str, default: Any = None) -> Any:
            if isinstance(obj, dict):
                return obj.get(key, default)
            return getattr(obj, key, default)

        call_id = get_field(call_response, "id") or get_field(call_response, "call_id")
        raw_status = str(get_field(call_response, "status", "failed")).lower()

        # Parse confidence defensively
        raw_confidence = get_field(call_response, "completion_confidence", 0.0)
        confidence_val: float = 0.0
        if isinstance(raw_confidence, dict):
            confidence_val = float(raw_confidence.get("score", 0.0))
        elif isinstance(raw_confidence, (int, float)):
            confidence_val = float(raw_confidence)

        # Parse structured result
        raw_result = get_field(call_response, "structured_result") or get_field(call_response, "result")
        if not raw_result and get_field(call_response, "recipients"):
            recs = get_field(call_response, "recipients")
            if isinstance(recs, list) and len(recs) > 0 and isinstance(recs[0], dict):
                raw_result = get_field(recs[0], "structured_result")

        structured_obj: Optional[CallETriageStructuredResult] = None
        if raw_result:
            if isinstance(raw_result, dict):
                structured_obj = CallETriageStructuredResult.model_validate(raw_result)
            elif isinstance(raw_result, CallETriageStructuredResult):
                structured_obj = raw_result

        # Extract evidence transcript reference
        evidence_dict: Dict[str, Any] = {}
        raw_evidence = get_field(call_response, "evidence")
        if isinstance(raw_evidence, dict):
            evidence_dict = raw_evidence
        else:
            transcript = get_field(call_response, "transcript")
            if transcript:
                evidence_dict = {"transcript": transcript}

        task_completed = (raw_status == "completed" and structured_obj is not None)

        return CallETriageOutput(
            call_id=call_id,
            status=raw_status,
            task_completed=task_completed,
            completion_confidence=confidence_val,
            structured_result=structured_obj,
            evidence=evidence_dict,
            error=None,
        )

    except Exception as exc:
        sanitized_err = sanitize_error_message(str(exc))
        logger.error("[CALL-E Failure] Triage call to %s failed: %s", masked, sanitized_err)
        return CallETriageOutput(
            call_id=None,
            status="failed",
            task_completed=False,
            completion_confidence=0.0,
            structured_result=None,
            evidence={},
            error=sanitized_err,
        )
