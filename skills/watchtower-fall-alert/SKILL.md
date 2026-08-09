---
name: watchtower-fall-alert
description: Computer-vision fall detection that triggers a CALL-E phone call to a caregiver, with a human-approved escalation path to a secondary contact before anyone calls emergency services.
---

# Watchtower — Fall Detection with CALL-E Escalation

Watchtower is a home-safety Agent Skill that watches a room using computer
vision, and when it detects a fall, uses CALL-E to phone a caregiver with a
spoken alert, collect a verbal decision, and — only if the caregiver
explicitly says so — escalate to a second contact. It never contacts
emergency services on its own.

## What it does

A camera feed is run through a custom-trained YOLO model (`best.pt`) that
classifies frames as `fall` or `non-fall`. When a fall is detected with
enough confidence, held for enough consecutive frames, and outside a
cooldown window, Watchtower treats it as a real event and:

1. Calls a designated caregiver via CALL-E, describing what was detected
   (room, time) and asking for a clear decision: **dismiss** as a false
   alarm, or **escalate**.
2. Records that decision.
3. If the caregiver says **escalate** (or CALL-E can't get a clear answer
   at all), places a **second** call — still to a human secondary contact,
   never to emergency services directly — so a real person always makes
   the final call to 911 themselves.
4. Logs every event (timestamp, room, confidence, decision, call status)
   to a local SQLite database, viewable through a live status dashboard.

## When to use it

Home safety monitoring for people aging in place, living alone, or living
with a visual impairment — situations where a missed notification could
mean a fall goes unnoticed for hours. A ringing phone reaches people who
wouldn't check an app or a push notification.

Not intended as a medical device or a substitute for professional medical
alert systems. It's a community reference implementation showing how
CV-triggered events can drive a CALL-E phone call safely.

## How it works

```
Camera → YOLO fall detection → confidence + consecutive-frame + cooldown
       → CALL-E call to caregiver → structured decision (dismiss/escalate)
       → if escalate/unknown → CALL-E call to secondary contact
       → event logged to SQLite → dashboard shows live status + history
```

### Components

| File | Purpose |
|---|---|
| `scripts/fall_detector.py` | FastAPI app: camera capture, YOLO + ByteTrack detection, fall-event logic, SQLite logging, `/detect` (video), `/status` (JSON), `/history` (JSON), and a built-in HTML dashboard at `/`. |
| `scripts/calle_trigger.py` | CALL-E SDK integration. Places the caregiver call with a structured `result_schema`, handles retries on transient network timeouts, and places the escalation call if needed. |
| `scripts/dashboard.py` | Optional Streamlit dashboard — a pure display layer that polls `/status` and `/history` from the FastAPI backend and embeds the live video feed. Run this instead of, or alongside, the built-in HTML dashboard. |

## Setup

Requires Python 3.10+, a webcam or camera source, a CALL-E account, and
your own fall-detection YOLO model (or a suitable pretrained/fine-tuned
substitute — see Limitations).

```bash
pip install ultralytics opencv-python supervision fastapi uvicorn calle-ai
# optional, for the Streamlit dashboard:
pip install streamlit requests
```

Set your CALL-E API key and the phone numbers Watchtower will call:

```bash
export CALLE_API_KEY="your_calle_api_key"
export WATCHTOWER_CAREGIVER_PHONE="+1..."      # primary contact, E.164 format
export WATCHTOWER_SECONDARY_PHONE="+1..."      # escalation contact, E.164 format
```

Place your trained model at `scripts/best.pt`. Confirm its class names match
`FALL_CLASS_NAME` in `fall_detector.py` (defaults to `"fall"`, matching a
model with `{0: 'non-fall', 1: 'fall'}`).

## Running it

```bash
cd scripts
python fall_detector.py
```

Open `http://localhost:5000/` for the built-in dashboard, or run the
Streamlit version in a second terminal:

```bash
streamlit run dashboard.py
```

## Consent and disclosure

Before deploying Watchtower for a real person:

- The **resident** must consent to being monitored by camera in that room.
- The **caregiver** and **secondary contact** must consent to being called
  by an automated system on behalf of the resident, and understand what
  information will be disclosed to them (room, approximate time, and the
  fact that a possible fall was detected — no other personal or medical
  information is shared).
- Consent should be collected and documented at setup time, outside of
  Watchtower itself (e.g. a signed agreement or a recorded verbal
  confirmation) — Watchtower does not manage consent collection.

## Safety design

Watchtower follows this repository's safety-by-default principles,
closely mirroring the human-approval pattern used in
[`deployment-approval-call`](../deployment-approval-call/):

- **CALL-E never autonomously contacts emergency services.** The only
  actions it takes are: call the caregiver, and — if the caregiver
  escalates or can't be reached with a clear answer — call a second human.
  A real person always makes the actual emergency call.
- **Ambiguous results fail toward escalation, not silence.** If CALL-E
  can't extract a clear decision from the caregiver call (bad connection,
  unclear response, no pickup), Watchtower treats that as `unknown` and
  escalates to the secondary contact rather than doing nothing. Staying
  silent on an ambiguous fall is a worse failure mode than one unnecessary
  extra call.
- **Consecutive-frame and cooldown logic reduce false alarms.** A single
  flickery detection doesn't trigger a call — the fall class must be seen
  across multiple consecutive frames above a confidence threshold, and
  repeat events are suppressed for a cooldown window so one fall doesn't
  spam multiple calls.
- **Transient network failures are retried, not treated as call
  failures.** CALL-E places the phone call first, then polls for the
  result — a timeout during that polling step doesn't necessarily mean
  the call itself failed. `calle_trigger.py` retries fetching the result
  before falling back to a safe default.
- **All example phone numbers in this skill are fictional
  placeholders.** Real numbers are supplied via environment variables at
  deploy time, never committed.
- **Every event is logged**, including failures, so there's an auditable
  history of what was detected and what action was taken.

## Example event flow

```
FALL EVENT: {'event': 'fall_detected', 'timestamp': '2026-08-09T14:12:03+00:00',
             'confidence': 0.81, 'room': 'living_room'}

[Watchtower] Fall detected in living_room at 2026-08-09T14:12:03+00:00
             (confidence=0.81). Calling caregiver...
Caregiver call status: completed
Task completed: True
Structured result: {'decision': 'escalate'}
[Watchtower] Caregiver escalated. Calling secondary contact...
Escalation call status: completed
```

## Limitations

- Ships without a pretrained fall-detection model — you must supply your
  own `best.pt` trained on fall/non-fall data (or adapt the detection
  logic to a pose-based approach if you don't have one).
- Single-camera, single-resident design. Multi-room or multi-person
  support would need per-camera process instances and person-tracking
  across cameras, which this skill does not implement.
- CV-only detection carries the usual limitations of any vision model:
  poor lighting, occlusion, and unusual camera angles can affect
  accuracy. This should not be relied on as a sole safety measure for
  high-risk situations without additional safeguards (wearable fall
  detectors, regular check-ins, etc.).
- The SQLite log is local to the machine running `fall_detector.py` and
  is not encrypted at rest — consider this if logging real events for a
  real deployment.