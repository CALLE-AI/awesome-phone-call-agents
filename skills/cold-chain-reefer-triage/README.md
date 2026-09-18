# Cold Chain Reefer Triage Agent (`cold-chain-reefer-triage`)

An autonomous voice-telephony triage agent for refrigerated freight logistics, built with the **CALL-E Python SDK (`calle-ai`)** and **Pydantic V2**.

Designed for inclusion in [`CALLE-AI/awesome-phone-call-agents`](https://github.com/CALLE-AI/awesome-phone-call-agents).

---

## Overview

When IoT sensors in a refrigerated trailer ("reefer") detect a temperature excursion (e.g. ice cream warming toward melting point, vaccines exceeding 36°F, or meat refrigeration failing), immediate intervention is required to avoid complete cargo loss ($30,000–$250,000+ per trailer).

This agent autonomously calls the commercial truck driver, verifies their safety, inspects the mechanical state of the reefer unit, confirms FMCSA Hours of Service (HOS) availability, and extracts structured remediation intent directly into an actionable JSON payload.

---

## Installation

```bash
pip install calle-ai pydantic
```

---

## Quickstart

```python
import os
from calle import CalleClient
from triage import initiate_reefer_triage

# 1. Initialize CALL-E Client
client = CalleClient(
    api_key=os.environ["CALLE_API_KEY"],
    base_url=os.environ.get("CALLE_BASE_URL", "https://api.heycall-e.com")
)

# 2. Trigger Triage Phone Call
result = initiate_reefer_triage(
    client=client,
    driver_phone="+12065550198",
    driver_name="Marcus Vance",
    truck_id="TRK-902",
    trailer_id="TRL-8841",
    current_temp_f=39.5,
    setpoint_temp_f=34.0,
    nearest_cold_hub_name="Lincoln Cold Logistics",
    nearest_cold_hub_eta_minutes=18,
    commodity_type="Produce",
    allowed_temp_range_str="33°F to 36°F"
)

# 3. Handle Structured Output
if result.task_completed and result.structured_result:
    print(f"Agreement: {result.structured_result.selected_option}")
    print(f"HOS Remaining: {result.structured_result.driver_hos_minutes_remaining} minutes")
    print(f"Sweating Detected: {result.structured_result.cargo_sweating_detected}")
else:
    print(f"Call incomplete or failed: {result.status} (Error: {result.error})")
```

---

## Structured Output Schema

The agent returns a `CallETriageOutput` containing a strictly validated `CallETriageStructuredResult`:

```json
{
  "driver_verified_safe_location": true,
  "reefer_engine_running": true,
  "air_bulkhead_obstructed": false,
  "cargo_sweating_detected": false,
  "driver_reported_alarm_code": "ALARM 18 - HIGH ENGINE TEMP",
  "driver_hos_minutes_remaining": 45,
  "selected_option": "DIVERT_TO_COLD_HUB",
  "emergency_reported": false
}
```

---

## Telephony Best Practices Enforced

1. **Safety First**: Drivers are first asked to confirm they are safely stopped or parked before answering checklist questions.
2. **Deterministic Task Prompting**: Task prompt explicitly starts with `Call {phone} and ...` per CALL-E requirements.
3. **Defensive Parsing**: Handles float and dictionary confidence scores (`{"score": float, "label": str}`).
4. **Zero-Redial Policy**: Never enters unconstrained redial loops; dropped/unanswered calls yield structured failure states for human dispatch alerting.
