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
| `scripts/calle_trigger.py` | CALL-E SDK integration. Places the caregiver call with a structured `result_schema`, validates and authorizes destination numbers, and places the escalation call only after a completed, explicit "escalate" decision. Does not retry - any error or ambiguous result stops immediately. Dry-run by default. |
| `scripts/dashboard.py` | Optional Streamlit dashboard — a pure display layer that polls `/status` and `/history` from the FastAPI backend and embeds the live video feed. Run this instead of, or alongside, the built-in HTML dashboard. |

## Setup

Requires Python 3.10+, a webcam or camera source, a CALL-E account, and
your own fine-tuned fall-detection YOLO model (see Limitations).

```bash
cd skills/watchtower-fall-alert/scripts
pip install -r requirements.txt
```

(`requirements.txt` includes the Streamlit dashboard's dependencies too;
`fall_detector.py` and the built-in HTML dashboard don't need Streamlit
installed to run, only `dashboard.py` does.)

**Watchtower is safe by default: it will not place a real phone call
unless you explicitly opt in for that run.** Just running it with no
extra setup performs a dry run and requires no CALL-E account or phone
numbers at all.

The server also requires an API key protecting its routes, since
`/detect`, `/status`, and `/history` are reachable by anyone on the same
network otherwise. This is required even for a dry run, since the video
feed and dashboard are always network-reachable while the server runs:

```bash
export WATCHTOWER_API_KEY=$(python -c "import secrets; print(secrets.token_urlsafe(24))")
```

This skill ships with a reference fall-detection model at
`scripts/best.pt` (resolved relative to `fall_detector.py`'s own
location, regardless of which directory you run the command from) so
it's runnable out of the box. It is a reference/example model, not a
production-grade one — for real deployment, replace it with your own
model fine-tuned on fall/non-fall data representative of your actual
camera angle, lighting, and environment. If `scripts/best.pt` is ever
missing (e.g. a shallow clone, LFS not pulled, or your own replacement
not yet added), `fall_detector.py` fails immediately with a clear error
rather than crashing deeper in the pipeline. Confirm your model's class
names match `FALL_CLASS_NAME` in `fall_detector.py` (defaults to
`"fall"`, matching a model with `{0: 'non-fall', 1: 'fall'}`).

### Going live (placing real calls)

Real calls require ALL of the following set together — this is
deliberately more than just an API key, so a real call is never placed
by accident:

```bash
export CALLE_API_KEY="your_calle_api_key"
export WATCHTOWER_CAREGIVER_PHONE="+1..."          # primary contact, strict E.164
export WATCHTOWER_SECONDARY_PHONE="+1..."          # escalation contact, strict E.164
export WATCHTOWER_AUTHORIZED_NUMBERS="+1...,+1..." # must contain BOTH numbers above, exactly
export WATCHTOWER_CONFIRM_LIVE_CALL="I_UNDERSTAND_THIS_PLACES_REAL_PHONE_CALLS"
```

If any of these is missing, misformatted, or doesn't match exactly,
`calle_trigger.py` refuses to place the call rather than guessing or
falling back to a default.

## Running it

```bash
cd scripts
python fall_detector.py
```

Open `http://localhost:5000/?key=YOUR_WATCHTOWER_API_KEY` for the
built-in dashboard, or run the Streamlit version in a second terminal
(it reads `WATCHTOWER_API_KEY` from the environment automatically):

```bash
export WATCHTOWER_API_KEY="the same key"
streamlit run dashboard.py
```

## Stopping it (cancellation behavior)

Watchtower is not a scheduled or recurring job — it's a long-running
process that watches the camera feed continuously while active. There is
no background task, cron entry, or persistent job to cancel. There are
two distinct ways monitoring stops:

**Manual stop (you decide to shut it down):**

```bash
# in the terminal running fall_detector.py:
Ctrl+C
```

This immediately releases the camera and stops the FastAPI server. If a
CALL-E call is in progress when you stop the process, the call itself
continues on CALL-E's side until it naturally completes (CALL-E calls are
not cancelled by stopping the local script) — only the detection loop and
video stream are affected locally.

**Automatic stop (an ambiguous result halts detection for you):**

If a caregiver call comes back ambiguous — unclear decision, no pickup,
a provider error — Watchtower stops detecting new falls entirely and the
dashboard shows `STOPPED - Needs Review`. This is intentional and is not
a bug: it prevents the system from re-detecting the same unresolved fall
after the cooldown window and dialing again without ever having gotten a
real answer the first time.

This state does not clear on its own. After a human has reviewed the
event (check `/history` or the dashboard for what happened), resume
monitoring explicitly:

```bash
curl -X POST "http://localhost:5000/reset?key=$WATCHTOWER_API_KEY"
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
  actions it takes are: call the caregiver, and — only if the caregiver
  gives an explicit, completed "escalate" decision — call a second
  human. A real person always makes the actual emergency call.
- **Ambiguous results stop the system, not escalate it further.** If
  CALL-E can't extract a clear decision (bad connection, unclear
  response, no pickup, a provider-side error), the outcome is `unknown`
  and Watchtower **stops**: no retry of the caregiver call, no automatic
  call to the secondary contact, and detection itself halts rather than
  re-arming after the cooldown. An automated system deciding on its own
  to place a second call is itself an unauthorized escalation — the
  opposite of the human-approval principle this skill enforces. Clearing
  this state requires an explicit `POST /reset` after a human reviews
  the event (see `references/safety.md` §4).
- **Consecutive-frame and cooldown logic reduce false alarms** for
  genuinely resolved events. A single flickery detection doesn't trigger
  a call — the fall class must be seen across multiple consecutive
  frames above a confidence threshold. The cooldown window only applies
  after a `dismiss` or `escalate` outcome; an `unknown` outcome does not
  re-arm on a timer at all (see above).
- **No automatic retries.** CALL-E's call lifecycle involves placing the
  call and then polling for its result; a failure in either step is
  treated as ambiguous and handled per the point above, rather than
  retried. Retrying risks placing a duplicate, confusing call to an
  already-contacted caregiver.
- **Live calls require explicit, layered opt-in.** A real call needs an
  API key, strict E.164-validated numbers, those numbers present in an
  authorized allowlist, AND a separate confirmation phrase set for that
  run — not just one of these. Absent any of them, Watchtower dry-runs.
- **All example phone numbers in this skill's docs and defaults are
  NANP's officially reserved fictional range** (555-0100 through
  555-0199). Real numbers are supplied via environment variables at
  deploy time, never committed.
- **All network-reachable routes require an API key.** `/detect`,
  `/status`, `/history`, `/`, and `/reset` are otherwise open to anyone
  on the same network.
- **Phone numbers and provider error text are redacted before being
  printed or logged** — not just truncated; any phone-number-shaped
  substring is actively replaced, including inside error messages that
  might otherwise echo a number back.
- **Every event is logged**, including ambiguous/failed ones, so there's
  an auditable history of what was detected and what action was taken.

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

- The bundled `scripts/best.pt` is a reference/example fall-detection
  model, not validated for production or clinical use. It should be
  treated as a starting point to confirm the pipeline works, not as a
  reliable detector for a real deployment — replace it with your own
  model fine-tuned on fall/non-fall data representative of your actual
  camera angle, lighting, and environment before relying on this for a
  real person. Generic pretrained YOLO checkpoints (e.g. `yolov8n.pt`)
  are trained for general object detection, not fall classification,
  and are not a substitute either without fine-tuning — or adapting the
  detection logic to a pose-based approach instead.
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
- An ambiguous or failed caregiver call result is not automatically
  retried or escalated (see `references/safety.md` §4/§6) — it requires
  a human to notice and follow up. This skill does not include an
  operator-alerting mechanism (e.g. a second notification channel) for
  ambiguous results beyond the dashboard and database log.