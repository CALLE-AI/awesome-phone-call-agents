# SentinelCall ANC Follow-Up

A demo app that places a structured outbound call via CALL-E to a patient
who missed a scheduled antenatal care (ANC) visit, screens for WHO-standard
obstetric danger signs, and escalates any positive finding as a FHIR
`Observation` to a connected CliniqBridge (or compatible) FHIR MCP server.

This is a runnable demo app, not an SDK or supported CALL-E product API.

## What it does

- Plans and runs one CALL-E call per follow-up request, with a scripted
  danger-sign screening goal
- Polls for the call result and reads the real transcript
- Extracts reported danger signs via simple keyword matching (not a
  CALL-E structured-output feature -- this app does its own parsing)
- Escalates any positive finding to a FHIR server via CliniqBridge's
  `create_observation` tool

## Side effects

**This app can place a real outbound phone call to a real phone number.**
By default it does not -- see Dry-run mode below.

When a real call is placed and a danger sign is detected, this app also
writes a new `Observation` resource to whichever FHIR server your
CliniqBridge instance is configured to reach.

## Dry-run mode (default)

`DRY_RUN=true` is the default in `.env.example`. In this mode, `POST
/followups` does not contact CALL-E or place any call -- it returns a
preview of what would be sent (masked phone number, call script) so you can
verify behavior safely.

To place a real call, set `DRY_RUN=false` explicitly in your `.env`. Only do
this with a phone number you have explicit permission to call.

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

Trigger a follow-up (dry-run by default):

```bash
curl -X POST http://127.0.0.1:8000/followups \
  -H "Content-Type: application/json" \
  -d '{"phone": "+15550100XX", "region": "US", "patient_first_name": "Jane", "missed_visit_date": "2026-07-20"}'
```

(`+15550100XX` is a fictional reserved sample number -- replace the `XX`
digits with a real number only when you intend a real, consented call and
have set `DRY_RUN=false`.)

Check a live run's result (only meaningful when `DRY_RUN=false`):

```bash
curl http://127.0.0.1:8000/followups/<run_id>
```

## Credential handling

No CALL-E API key is stored or required by this app directly -- it shells
out to the locally authenticated `calle` CLI, which manages its own token
cache (`calle auth login` / `calle auth status`). This app never reads,
logs, or transmits that token itself.

`CLINIQBRIDGE_API_KEY` in `.env` is optional and only sent as a header if
set; leave it blank if your CliniqBridge instance has no auth configured
(true for public demo/test instances). Never commit a real key -- `.env` is
git-ignored; only `.env.example` (with placeholder values) is tracked.

## Test data

`create_test_patient.py` creates one synthetic patient on the public HAPI
FHIR test server (`https://hapi.fhir.org/baseR4`) for demo purposes. This is
not real patient data and this app must never be pointed at a real
production patient record or hospital system.

```bash
python create_test_patient.py
```

## Cancellation / rollback

This app does not create recurring or scheduled calls -- each `/followups`
request places at most one call attempt, so there is no recurring job to
cancel. If a call is in progress, it can only be stopped by the CALL-E
platform itself; this app has no cancel endpoint.

## Known limitations

- CALL-E's CLI does not currently expose a structured `result_schema` for
  call outcomes, so danger-sign detection here is simple transcript keyword
  matching, not a platform feature.
- As of this writing, CALL-E's supported recipient regions do not include
  Nigeria, the project's primary intended deployment market. This demo
  targets a supported region instead. Feedback requesting Nigeria support
  has been filed with the CALL-E team separately, citing this use case.