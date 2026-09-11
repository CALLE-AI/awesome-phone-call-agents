# Example — Watchtower End-to-End Walkthrough

This walks through a single fall event from detection to resolution,
showing the real output at each stage. Useful as a reference for what
"working correctly" looks like, and for reviewers who want to understand
the flow without running the code themselves.

## Scenario

A camera is monitoring a living room. `WATCHTOWER_ROOM=living_room`.
`WATCHTOWER_CAREGIVER_PHONE` and `WATCHTOWER_SECONDARY_PHONE` are set to
a family member's and a neighbor's numbers respectively (real numbers in
an actual deployment; fictional placeholders in this doc).

## 1. Detection

The YOLO model (`best.pt`) classifies frames as `fall` or `non-fall`.
Once the fall class has been seen for `CONSECUTIVE_FRAMES_REQUIRED`
frames in a row, above `FALL_CONFIDENCE_THRESHOLD`, and outside the
cooldown window, `check_for_fall()` returns an event:

```python
{
    "event": "fall_detected",
    "timestamp": "2026-08-09T14:12:03+00:00",
    "confidence": 0.81,
    "room": "living_room",
}
```

Terminal output from `fall_detector.py`:

```
FALL EVENT: {'event': 'fall_detected', 'timestamp': '2026-08-09T14:12:03+00:00',
             'confidence': 0.81, 'room': 'living_room'}
```

The event is immediately written to `watchtower.db`:

```sql
id  room          confidence  event_timestamp            decision  call_status  created_at
7   living_room   0.81        2026-08-09T14:12:03+00:00  NULL      calling      2026-08-09T14:12:03+00:00
```

The dashboard's status flips to **Fall Detected**, then **Calling
Caregiver**.

## 2. The caregiver call

`calle_trigger.call_caregiver()` builds a task description and sends it
to CALL-E along with a `result_schema` describing the decision it needs
back:

```python
task = (
    "Call +15550101234. Identify yourself as Watchtower, a home "
    "safety monitoring assistant. Tell them: 'A possible fall was "
    "detected in the living room at 2026-08-09T14:12:03+00:00.' Ask "
    "them to make a decision: should this be dismissed as a false "
    "alarm, or should it be escalated? Wait for a clear verbal "
    "decision before ending the call."
)

result_schema = {
    "type": "object",
    "required": ["decision"],
    "properties": {
        "decision": {"type": "string", "enum": ["dismiss", "escalate", "unknown"]}
    },
}
```

CALL-E dials the number, has the conversation, and returns a structured
result. Example terminal output for a call where the caregiver decides
to escalate:

```
Caregiver call status: completed
Task completed: True
Structured result: {'decision': 'escalate'}
```

## 3a. If the caregiver dismisses

```
[Watchtower] Caregiver dismissed as false alarm. No further action.
```

Database row updated:

```sql
id  ...  decision  call_status  updated_at
7   ...  dismiss   resolved     2026-08-09T14:13:40+00:00
```

Dashboard status moves to **Resolved**, then automatically back to
**Monitoring** once the cooldown window passes.

## 3b. If the caregiver escalates (or the decision is unclear)

```
[Watchtower] Caregiver escalated. Calling secondary contact...
Escalation call status: completed
Task completed: True
```

`calle_trigger.call_secondary_contact_for_escalation()` places a second
call — to the configured secondary contact, never to emergency services
directly:

```python
task = (
    "Call +15550109876. Identify yourself as Watchtower, a home safety "
    "monitoring assistant. Tell them: 'A fall was detected in the "
    "living room at 2026-08-09T14:12:03+00:00, and the primary "
    "caregiver has escalated this. Please check on the resident now, "
    "and call emergency services yourself if needed.' Confirm they "
    "received and understood the message before ending the call."
)
```

Database row updated:

```sql
id  ...  decision   call_status  updated_at
7   ...  escalate   resolved     2026-08-09T14:14:55+00:00
```

## 4. Checking status via the API directly

While `fall_detector.py` is running, you can query its state without
using the dashboard at all:

```bash
curl http://localhost:5000/status
```

```json
{
  "status": "resolved",
  "last_event": {
    "event": "fall_detected",
    "timestamp": "2026-08-09T14:12:03+00:00",
    "confidence": 0.81,
    "room": "living_room"
  },
  "last_decision": "escalate",
  "last_updated": "2026-08-09T14:14:55+00:00"
}
```

```bash
curl http://localhost:5000/history?limit=5
```

```json
[
  {
    "id": 7,
    "room": "living_room",
    "confidence": 0.81,
    "event_timestamp": "2026-08-09T14:12:03+00:00",
    "decision": "escalate",
    "call_status": "resolved",
    "created_at": "2026-08-09T14:12:03+00:00",
    "updated_at": "2026-08-09T14:14:55+00:00"
  }
]
```

## 5. What a network failure looks like (and recovers from)

If the result-polling step hits a transient timeout, you'll see retries
before it either succeeds or falls back safely:

```
[Watchtower] CALL-E request failed on attempt 1/3: CALL-E API request timed out.
[Watchtower] CALL-E request failed on attempt 2/3: CALL-E API request timed out.
Caregiver call status: completed
Task completed: True
Structured result: {'decision': 'dismiss'}
```

Or, if all retries are exhausted:

```
[Watchtower] All 3 attempts failed (CALL-E API request timed out.).
Treating as 'unknown' - will escalate as a safe default.
[Watchtower] Caregiver escalated. Calling secondary contact...
```

## 6. Testing the CALL-E integration without the camera

`calle_trigger.py` can be run directly to fire a simulated fall event,
useful for testing the call flow in isolation:

```bash
python calle_trigger.py
```

```python
test_event = {
    "event": "fall_detected",
    "timestamp": "2026-08-01T15:42:00+00:00",
    "confidence": 0.87,
    "room": "living_room",
}
handle_fall_event(test_event)
```

This is the fastest way to verify your `CALLE_API_KEY` and phone number
environment variables are configured correctly before relying on a real
detected fall to trigger the first test call.