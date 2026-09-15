"""
Cold Chain Reefer Triage Agent — Standalone Telephony Skill
==========================================================
A standalone voice-telephony triage primitive powered by the CALL-E Python SDK (`calle-ai`).

This module has zero backend or framework dependencies (no FastAPI, LangGraph, or Langfuse)
and is designed for direct submission to `CALLE-AI/awesome-phone-call-agents`.
"""

import logging
from typing import Any, Dict, Literal, Optional, Union
from pydantic import BaseModel, ConfigDict, Field

logger = logging.getLogger("cold_chain_reefer_triage")


# ==============================================================================
# 1. Pydantic V2 Output Schemas
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
        description="Call outcome status: completed, busy, no_answer, failed, or unknown",
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
        description="Raw evidence dictionary containing transcript or call recording references",
    )
    error: Optional[str] = Field(
        default=None,
        description="Error message if the call failed or structured extraction threw an exception",
    )


# ==============================================================================
# 2. Standalone Telephony Execution Primitive
# ==============================================================================

def sanitize_json_schema_for_calle(schema: Dict[str, Any]) -> Dict[str, Any]:
    """Sanitize a JSON Schema dictionary for CALL-E compatibility."""
    import copy

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
    client: Any,
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
) -> CallETriageOutput:
    """
    Initiates an autonomous CALL-E voice triage call to a commercial truck driver.

    Invocation Rules:
    1. Prepend phone number in task string: `Call {driver_phone} and {task}`.
    2. Enforce Zero-Redial: Exactly 1 outbound call. If call fails, returns status for ops escalation.
    3. Defensively parses `completion_confidence` (accepts float or `{"score": float, "label": str}`).
    """
    # Build explicit prompt instructions for CALL-E voice agent
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
        # Call CALL-E SDK
        logger.info(f"[CALL-E Dispatch] Target phone number: {driver_phone}")
        call_response = client.calls.create_and_wait(
            task=task_prompt,
            recipient=recipient_data,
            recipient_result_schema=clean_schema,
        )

        # Helper to extract attributes from dict or object safely
        def get_field(obj: Any, key: str, default: Any = None) -> Any:
            if isinstance(obj, dict):
                return obj.get(key, default)
            return getattr(obj, key, default)

        # Extract call attributes safely supporting both dict and object responses
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
        logger.error(f"CALL-E reefer triage failed: {exc}", exc_info=True)
        return CallETriageOutput(
            call_id=None,
            status="failed",
            task_completed=False,
            completion_confidence=0.0,
            structured_result=None,
            evidence={},
            error=str(exc),
        )
