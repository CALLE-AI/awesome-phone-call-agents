---
name: cold-chain-reefer-triage
description: Advisory voice telephony triage agent skill for refrigerated freight temperature excursions. Interrogates drivers on physical reefer status and HOS availability with safe no-call default execution.
license: MIT
metadata:
  tier: experimental
  author: piyushxlabs
---

# Cold Chain Reefer Triage Agent

An **advisory, experimental community agent skill** for voice-telephony triage powered by the **CALL-E Python SDK (`calle-ai`)**.

> **Notice:** This skill is an experimental reference implementation for automated voice checklists. Output recommendations are advisory and do not replace fleet manager oversight or FMCSA regulatory compliance.

When IoT sensors in a refrigerated trailer report a temperature excursion, this agent contacts the commercial driver, confirms they are safely stopped, executes a standardized mechanical checklist, assesses FMCSA Hours of Service (HOS) availability, and extracts structured remediation intent into an actionable JSON payload.

## Core Operational Principles

1. **No-Call Default**: Dry-run simulation mode is active by default (`live=False`). Placing real outbound phone calls requires explicit authorization (`--live` or `live=True`).
2. **Strict E.164 Validation**: Every destination phone number must strictly satisfy international E.164 format. Emergency numbers (911, 112, etc.) are rejected before payload creation.
3. **Transport Security**: Requires secure HTTPS endpoints (`https://`) for CALL-E API communications.
4. **Privacy & Masking**: Destination phone numbers are automatically masked in console outputs and trace logs (e.g. `+1303***0147`).
5. **Zero-Redial Policy**: Exactly one outbound call attempt is made. Dropped or unanswered calls yield structured failure states for human dispatcher review rather than automated redialing.

## Requirements

```bash
pip install calle-ai pydantic
```

## Structured Output Schema

The skill enforces the following Pydantic V2 schema (`CallETriageStructuredResult`):

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
        default=None, description="Alarms displayed on reefer microprocessor (e.g. 'ALARM 18')"
    )
    driver_hos_minutes_remaining: int = Field(
        ..., description="Driver-reported remaining driving hours in minutes under FMCSA Part 395"
    )
    selected_option: Literal[
        "DIVERT_TO_COLD_HUB",
        "CONTINUE_MONITORED",
        "ROADSIDE_SERVICE",
        "DRIVER_REFUSED"
    ] = Field(..., description="Remediation preference agreed upon with driver")
    emergency_reported: bool = Field(
        ..., description="Whether driver reported an active physical accident or hazard"
    )
```

## Usage

### 1. Default Dry-Run / Preview (No network calls)

```python
from triage import initiate_reefer_triage

# Runs safely without credentials
result = initiate_reefer_triage(
    driver_phone="+13035550147",
    driver_name="Marcus Vance",
    truck_id="TRK-902",
    trailer_id="TRL-8841",
    current_temp_f=39.5,
    setpoint_temp_f=34.0,
    nearest_cold_hub_name="Lincoln Cold Logistics",
    nearest_cold_hub_eta_minutes=18,
    commodity_type="Produce",
)

print(f"Status: {result.status}")
print(f"Structured Result: {result.structured_result.model_dump()}")
```

### 2. Authorized Live Outbound Call

```python
import os
from calle import CalleClient
from triage import initiate_reefer_triage, validate_calle_base_url

client = CalleClient(
    api_key=os.environ["CALLE_API_KEY"],
    base_url=validate_calle_base_url(os.environ.get("CALLE_BASE_URL")),
)

result = initiate_reefer_triage(
    driver_phone="+13035550147",
    driver_name="Marcus Vance",
    truck_id="TRK-902",
    trailer_id="TRL-8841",
    current_temp_f=39.5,
    setpoint_temp_f=34.0,
    nearest_cold_hub_name="Lincoln Cold Logistics",
    nearest_cold_hub_eta_minutes=18,
    commodity_type="Biologics",
    client=client,
    live=True,  # Explicit authorization required
)
```

### 3. CLI Runner

```bash
# Dry-run execution
python scripts/run_triage.py --phone +13035550147

# Live authorized call
export CALLE_API_KEY="your-api-key"
python scripts/run_triage.py --phone +13035550147 --live
```

## Operational Limits & Failure Modes

- **Accepted-Call vs. Unverified-Driver Boundary**: Telephony confirms self-attestation only. If driver responses are ambiguous or identity cannot be confirmed, confidence is discounted and the incident is escalated to a human dispatcher.
- **Network Drops & Timeouts (SIP 408)**: If the call encounters network disconnects, timeouts, or rings out unanswered, the call terminates with `status="failed"`. Under the Zero-Redial policy, no automated redials are initiated.
- **Advisory Authority Only**: Structured decisions (`selected_option`) are advisory recommendations. Mutating real-world fleet actions (route rerouting, dock booking, roadside service dispatch) requires verification and approval by a licensed fleet manager.

## Reference Documentation

- [Safety Reference](references/safety.md) — E.164 rules, emergency exclusion, transport security, and privacy masking.
- [Operational Limits](references/operational-limits.md) — Detailed failure modes, SIP timeout behaviors, and human-in-the-loop gates.
- [Usage Examples](references/examples.md) — Detailed Python SDK and CLI invocation examples.
- [Result Schema](references/result-schema.json) — Full JSON schema definition.
