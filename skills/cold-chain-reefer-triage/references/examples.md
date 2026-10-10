# Usage Examples

## 1. Default Dry-Run Execution (Python SDK)

The skill defaults to `live=False`, requiring zero telephony credentials and placing no network calls:

```python
from triage import initiate_reefer_triage

# Executes instantly in dry-run mode
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
print(f"Simulated Result: {result.structured_result.model_dump()}")
```

Console Output:
```text
[INFO] [DRY-RUN: No live call placed] Simulating autonomous reefer triage for +1303***0147
Status: completed
Simulated Result: {'driver_verified_safe_location': True, 'reefer_engine_running': True, 'air_bulkhead_obstructed': False, 'cargo_sweating_detected': False, 'driver_reported_alarm_code': 'ALARM 18 - HIGH ENGINE TEMP', 'driver_hos_minutes_remaining': 45, 'selected_option': 'DIVERT_TO_COLD_HUB', 'emergency_reported': False}
```

---

## 2. Authorized Live Call Execution (Python SDK)

Placing a live outbound call requires initializing `CalleClient` and explicitly setting `live=True`:

```python
import os
from calle import CalleClient
from triage import initiate_reefer_triage, validate_calle_base_url

api_key = os.environ["CALLE_API_KEY"]
base_url = validate_calle_base_url(os.environ.get("CALLE_BASE_URL"))

client = CalleClient(api_key=api_key, base_url=base_url)

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

if result.task_completed and result.structured_result:
    print(f"Driver Agreed Option: {result.structured_result.selected_option}")
    print(f"Driver HOS Remaining: {result.structured_result.driver_hos_minutes_remaining} min")
else:
    print(f"Call uncompleted: {result.status} (Reason: {result.error})")
```

---

## 3. CLI Runner Examples (`scripts/run_triage.py`)

### Dry-run preview:
```bash
python scripts/run_triage.py --phone +13035550147
```

### Live authorized outbound call:
```bash
export CALLE_API_KEY="your-api-key"
python scripts/run_triage.py --phone +13035550147 --live
```
