# ConfirmCall

ConfirmCall is a Google Calendar-connected appointment confirmation app that turns CALL-E phone-call outcomes into structured appointment actions.

It demonstrates a closed operational loop:

```text
Google Calendar
      ↓
Appointment parser
      ↓
ConfirmCall orchestrator
      ↓
CALL-E
      ↓
Structured outcome
      ↓
Decision engine
      ↓
Google Calendar writeback
      ↓
Streamlit dashboard
```

## What it does

ConfirmCall reads upcoming Google Calendar appointments explicitly marked for processing, prepares an appointment-confirmation task, interprets the result, and records one of these states:

* `confirmed`
* `cancelled`
* `reschedule_requested`
* `no_answer`
* `needs_human`
* `pending`

A requested replacement time is recorded for human review. ConfirmCall does not promise that the requested slot is available.

## Default behavior

ConfirmCall defaults to:

```python
DRY_RUN = True
```

The default workflow does not place a real phone call.

In dry-run mode:

* Google Calendar reads are real.
* Calendar writebacks are real.
* CALL-E conversation outcomes are simulated.
* Only events containing `CONFIRMCALL=true` are considered.
* Already-processed appointments are skipped.
* The included demo can be reset and replayed.

## CALL-E integration

The CALL-E service builds a structured appointment-confirmation task and supports:

* recipient configuration,
* structured result schemas,
* metadata,
* deterministic idempotency keys,
* completed-call polling,
* result parsing,
* call ID persistence.

Live calling is deliberately opt-in.

## Safety rules

Before using live mode:

1. The user must explicitly intend to place the call.
2. Use only a phone number you own or have permission to call.
3. Phone numbers must use E.164 format.
4. Do not expose API keys, OAuth tokens, or unmasked private phone numbers in logs or screenshots.
5. Do not repeatedly retry an ambiguous call outcome; route it to human review.
6. Already-processed appointments must not be called again automatically.
7. ConfirmCall creates no hidden recurring schedules.
8. Do not use this demo for emergency calling.
9. Do not use it to provide medical, legal, or financial advice or make high-stakes decisions on behalf of a person.

Ambiguous or unsupported outcomes fail closed to human review.

## Side effects

### Dry-run mode

Dry-run mode can still modify Google Calendar.

It may:

* change appointment status,
* update the event title,
* record a requested reschedule time,
* record a demo call identifier.

The included `Reset Demo` control restores the fictional demo appointments to `pending`.

### Live mode

Live mode can initiate a real outbound CALL-E phone call.

Once dialing has started, the phone call cannot be undone.

Before starting a live call, verify:

* recipient,
* consent or authorization,
* number,
* region,
* language,
* appointment details,
* call goal.

ConfirmCall uses deterministic idempotency keys to reduce duplicate call creation.

## Requirements

* Python 3.12+
* CALL-E Python SDK
* Google Calendar API
* Google OAuth desktop credentials
* Streamlit

Install:

```bash
python -m pip install -r requirements.txt
```

## Environment setup

Copy:

```text
.env.example
```

to:

```text
.env
```

Configure the required values locally.

Never commit:

```text
.env
credentials.json
token.json
```

Google OAuth desktop credentials should be saved locally as:

```text
credentials.json
```

The first successful OAuth flow creates:

```text
token.json
```

## Calendar metadata

A ConfirmCall-enabled event can use:

```text
CONFIRMCALL=true
CUSTOMER_NAME=Alice Demo
CUSTOMER_PHONE=+12025550123
SERVICE=Haircut Appointment
STATUS=pending
```

A reschedule request may later contain:

```text
STATUS=reschedule_requested
REQUESTED_TIME=Monday at 2:00 PM
CALL_ID=<call-id>
```

All repository samples use fictional test data.

## Run the demo

Seed fictional appointments:

```bash
python seed_demo_events.py
```

Run the CLI workflow:

```bash
python app.py
```

Run the dashboard:

```bash
python -m streamlit run dashboard/dashboard.py
```

The dashboard provides:

* appointment status metrics,
* estimated demo business impact,
* requested reschedule times,
* an automation audit,
* call IDs,
* Reset Demo,
* Run ConfirmCall.

## Tests

Run:

```bash
python -m pytest -v
```

The current suite tests:

* confirmations,
* cancellations,
* reschedule requests,
* no-answer outcomes,
* unknown-outcome escalation,
* Calendar metadata parsing,
* requested-time persistence,
* non-ConfirmCall filtering,
* invalid status handling,
* CALL-E task construction.

Tests do not place phone calls.

## Cancellation and rollback

Before a live call begins, simply do not enable or start live execution.

Once a real call has begun, the dial itself cannot be rolled back.

Calendar changes made by the included fictional demo can be reset using the dashboard's `Reset Demo` control.

Unknown or failed processing is routed to `needs_human` rather than automatically retried.

## Live verification

Live verification is optional and must be deliberate.

The default repository path is no-call/dry-run.

Before performing a live verification:

* use an authorized supported-region recipient,
* confirm the CALL-E plan,
* verify the recipient and goal,
* ensure the recipient is ready,
* execute only once,
* inspect the returned result before retrying anything.

## Provider and integrations

- Phone-call provider: CALL-E
- Appointment system: Google Calendar
- Dashboard: Streamlit

This is a runnable demo application, not a CALL-E SDK or supported product API.