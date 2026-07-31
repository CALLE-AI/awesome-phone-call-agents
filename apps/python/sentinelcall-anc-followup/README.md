# SentinelCall ANC Follow-Up

A demo app that places a structured outbound call via CALL-E to a patient
who missed a scheduled antenatal care (ANC) visit, screens for WHO-standard
obstetric danger signs, and supports escalating any human-confirmed finding
as a FHIR `Observation` to a connected CliniqBridge (or compatible) FHIR
MCP server.

This is a runnable demo app, not an SDK or supported CALL-E product API.

## What it does

- Plans and runs one CALL-E call per follow-up request, with a scripted
  danger-sign screening goal. The call script explicitly discloses that
  the caller is an AI assistant.
- Polls for the call result and reads the real transcript (read-only).
- Extracts a *preview* of reported danger signs by pairing each screening
  question with the immediately following patient answer and checking for
  affirmative vs. negative language -- not a blind keyword search across
  the whole transcript (an earlier version had this bug; see CHANGELOG
  note below).
- Escalation to CliniqBridge is a **separate, explicit, human-confirmed
  action** -- not an automatic side effect of checking call status.

## Side effects

**This app can place a real outbound phone call to a real phone number.**
By default it does not -- see Dry-run mode below. Live calls require
explicit consent confirmation and an API key.

When escalation is explicitly confirmed by a human reviewer, this app
writes a new `Observation` resource (status `preliminary`, not `final`) to
whichever FHIR server your CliniqBridge instance is configured to reach.

## Dry-run mode (default)

`DRY_RUN=true` is the default. In this mode, `POST /followups` does not
contact CALL-E or place any call -- it returns a preview of what would be
sent (masked phone number, call script).

To place a real call, set `DRY_RUN=false` and provide:
- A valid `SENTINELCALL_API_KEY` (see Authentication below)
- `consent_confirmed: true` in the request body
- An `Idempotency-Key` header, to prevent duplicate calls from retried or
  repeated requests

## Authentication

Set `SENTINELCALL_API_KEY` in `.env`. All endpoints require this value in
the `X-API-Key` request header once set. If left blank, only dry-run
requests are permitted -- live calls are blocked entirely without a key.

## Setup

Requires Python 3.10+ and an authenticated `calle` CLI session
(`calle auth login`) already completed on your machine.

```bash
pip install -r requirements.txt
cp .env.example .env
```

Run:

```bash
uvicorn main:app --reload --port 8000
```

## Usage

**1. Trigger a follow-up (dry-run by default):**

```bash
curl -X POST http://127.0.0.1:8000/followups \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-key-if-set" \
  -d '{"phone": "+15550100XX", "region": "US", "patient_first_name": "Jane", "missed_visit_date": "2026-07-20"}'
```

For a real call, add `"consent_confirmed": true` to the body and an
`Idempotency-Key` header, and set `DRY_RUN=false` in `.env`.

**2. Check a live run's status and see a danger-sign preview (read-only,
does not write any records):**

```bash
curl http://127.0.0.1:8000/followups/<run_id> -H "X-API-Key: your-key-if-set"
```

**3. After a human reviews the transcript and the preview, explicitly
confirm and commit an escalation:**

```bash
curl -X POST http://127.0.0.1:8000/followups/<run_id>/escalate \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-key-if-set" \
  -d '{"reviewed_by": "reviewer-name-or-id", "confirmed_signs": ["severe_headache_or_vision_change"]}'
```

This step is idempotent -- calling it again for the same `run_id` returns
`already_escalated` rather than writing a duplicate record.

## Credential handling

No CALL-E API key is stored or required by this app directly -- it shells
out to the locally authenticated `calle` CLI, which manages its own token
cache. This app never reads, logs, or transmits that token.

`SENTINELCALL_API_KEY` gates access to this app's own endpoints.
`CLINIQBRIDGE_API_KEY` is optional and only sent if set; leave it blank if
your CliniqBridge instance has no auth configured. Never commit real
values for any of these -- `.env` is git-ignored; only `.env.example`
(placeholders) is tracked.

## Test data

`create_test_patient.py` creates one synthetic patient on the public HAPI
FHIR test server (`https://hapi.fhir.org/baseR4`) for demo purposes. This
is not real patient data and this app must never be pointed at a real
production patient record or hospital system.

```bash
python create_test_patient.py
```

## Cancellation / rollback

This app does not create recurring or scheduled calls -- each `/followups`
request places at most one call attempt. There is no cancel endpoint for
an in-progress call; that can only be done at the CALL-E platform level.

## Known limitations (stated directly, not hidden)

- CALL-E's CLI does not currently expose a structured `result_schema` for
  call outcomes, so danger-sign detection here is rule-based
  question/answer pairing on the transcript, not a platform feature.
- FHIR Observations are written with status `preliminary`. The SNOMED
  codes used for each danger sign were selected for plausibility and have
  not been independently verified against an authoritative terminology
  browser -- do not treat records from this app as clinically validated.
- The idempotency and escalation-tracking stores are in-memory and reset
  on restart. A production deployment would need persistent storage.
- As of this writing, CALL-E has added support for Nigeria (NG) as a
  recipient region, which is this project's real intended market --
  earlier versions of this README noted NG was unsupported; that has
  since been resolved by the CALL-E team.