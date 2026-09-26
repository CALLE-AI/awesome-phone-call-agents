---
name: cold-chain-reefer-triage
description: Autonomous voice telephony triage agent for refrigerated transport temperature excursions. Calls commercial truck drivers, executes a standardized mechanical and cargo physical checklist, assesses HOS availability, and captures structured remediation intent.
license: MIT
---

# Cold Chain Reefer Triage Agent

A production-grade, autonomous voice-telephony triage primitive powered by the **CALL-E Python SDK (`calle-ai`)**.

This skill enables logistics platforms, telematics hubs, and autonomous fleet management systems to instantly contact commercial truck drivers when reefer trailer temperature excursions occur, gather verified on-site evidence, and record structured driver remediation decisions.

## Features

- **Automated Physical Checklist**: Guides drivers through checking return air bulkhead clearance, evaporator coil icing, reefer fuel levels, and unit controller alarm codes.
- **Safety First**: Confirms the vehicle is safely pulled over in a designated truck parking or rest area before initiating questions.
- **Structured Schema Extraction**: Enforces strict JSON Schema validation on call outcome, returning typed fields for downstream compliance and routing decisions.
- **Hours of Service (HOS) Verification**: Extracts driver-reported available drive time under FMCSA 49 CFR Part 395 rules.
- **Emergency Escalation**: Detects accidents, fires, or medical emergencies on call and triggers immediate operator intervention.

## Requirements

```bash
pip install calle-ai pydantic
```

## Structured Output Schema

The skill enforces the following Pydantic V2 schema:

```python
from typing import Literal, Optional
from pydantic import BaseModel, Field, ConfigDict

class CallETriageStructuredResult(BaseModel):
    model_config = ConfigDict(extra="ignore")

    driver_verified_safe_location: bool = Field(
        ..., description="Whether driver confirmed truck is stopped in a safe location"
    )
    reefer_engine_running: bool = Field(
        ..., description="Whether the diesel reefer refrigeration engine is operating"
    )
    air_bulkhead_obstructed: bool = Field(
        ..., description="Whether freight/pallets are blocking return airflow"
    )
    cargo_sweating_detected: bool = Field(
        ..., description="Whether condensation/sweating is visible on cargo"
    )
    driver_reported_alarm_code: Optional[str] = Field(
        default=None, description="Alarms displayed on reefer microprocessor"
    )
    driver_hos_minutes_remaining: int = Field(
        ..., description="Driver-reported remaining driving hours in minutes"
    )
    selected_option: Literal[
        "DIVERT_TO_COLD_HUB",
        "CONTINUE_MONITORED",
        "ROADSIDE_SERVICE",
        "DRIVER_REFUSED"
    ] = Field(..., description="Action agreed upon with driver")
    emergency_reported: bool = Field(
        ..., description="Whether driver reported an active accident or hazard"
    )

class CallETriageOutput(BaseModel):
    model_config = ConfigDict(extra="ignore")

    call_id: Optional[str] = None
    status: str = Field(..., description="CALL-E call status: completed, busy, no_answer, failed")
    task_completed: bool = Field(default=False)
    completion_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    structured_result: Optional[CallETriageStructuredResult] = None
    evidence: dict = Field(default_factory=dict)
    error: Optional[str] = None
```

## Usage Example

```python
import os
from calle import CalleClient
from triage import initiate_reefer_triage

# Initialize CALL-E Client
client = CalleClient(
    api_key=os.environ["CALLE_API_KEY"],
    base_url=os.environ.get("CALLE_BASE_URL", "https://api.heycall-e.com")
)

# Initiate autonomous driver triage call
triage_result = initiate_reefer_triage(
    client=client,
    driver_phone="+12065550198",
    driver_name="Marcus Vance",
    truck_id="TRK-902",
    trailer_id="TRL-8841",
    current_temp_f=39.5,
    setpoint_temp_f=34.0,
    nearest_cold_hub_name="Lincoln Cold Logistics",
    nearest_cold_hub_eta_minutes=18,
)

print(f"Call Status: {triage_result.status}")
if triage_result.structured_result:
    print(f"Action Agreed: {triage_result.structured_result.selected_option}")
    print(f"HOS Remaining: {triage_result.structured_result.driver_hos_minutes_remaining} min")
```

## Telephony Invocation Rules

1. **Phone Prefixing**: Invocations must prepend the recipient's phone number into the task string (`task = f"Call {driver_phone} and {task}"`).
2. **Zero-Redial Policy**: Never automatically re-dial a dropped, busy, or unanswered call; escalate immediately to a human supervisor.
3. **Prompt Injection Resistance**: All external inputs are treated as untrusted data and sanitized prior to task prompt interpolation.
