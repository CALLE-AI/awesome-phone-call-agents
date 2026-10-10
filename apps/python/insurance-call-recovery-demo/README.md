# Insurance Call Recovery Demo

A small verification app for the `insurance-call-recovery` Agent Skill.

It supports a deterministic dry-run by default and an explicit live mode for a configured CALL-E HTTP API.

## Requirements

- Python 3.10+
- No third-party runtime dependency is required for dry-run.
- Live mode requires a CALL-E API endpoint matching the adapter contract described below.

## Setup

```bash
cp .env.example .env
```

Set:

```text
CALL_E_BASE_URL=https://your-calle-endpoint.example
CALL_E_API_TOKEN=replace_me
```

The token must never be committed.

## Dry-run

Dry-run is the default and does not place a phone call:

```bash
python -m insurance_call_recovery.cli --input examples/claim.json --dry-run
```

Or:

```bash
python -m insurance_call_recovery.cli --input examples/renewal.json --dry-run
```

## Live mode

Live mode is explicitly opt-in:

```bash
python -m insurance_call_recovery.cli --input examples/claim.json --live --approve
```

The CLI still prints a preview before execution. `--approve` is required to permit the live call.

## CALL-E adapter contract

The adapter intentionally uses an HTTP boundary instead of inventing a provider SDK.

Logical endpoints:

```text
POST {CALL_E_BASE_URL}/plan_call
POST {CALL_E_BASE_URL}/run_call
GET  {CALL_E_BASE_URL}/get_call_run/{recovery_id}
```

The exact request/response schema must match the current CALL-E API documentation before live verification.

Expected plan request:

```json
{
  "task_description": "...",
  "destination": "+1555...",
  "structured_result_schema": {}
}
```

Expected plan response:

```json
{
  "recovery_id": "..."
}
```

Expected run request:

```json
{
  "recovery_id": "..."
}
```

Expected terminal call response:

```json
{
  "status": "completed",
  "transcript": "..."
}
```

The adapter also accepts an optional `failure_code`.

## Safety

- E.164 destination validation is strict.
- Phone numbers are masked in previews/results.
- Live mode requires explicit approval.
- Dry-run never calls CALL-E.
- No automatic redial.
- Recovery IDs prevent duplicate terminal calls within the local state store.
- Credentials come from environment variables and are never logged.
- Evidence verification is fail-closed.
