# CALL-E Workflow

This reference describes the exact CALL-E sequence for a single lead-qualification call. Planning is never permission to dial. The host scheduler handles recurrence; CALL-E handles exactly one call per scheduled run.

## Transport and authentication

- Base URL: `https://api.heycall-e.com`
- API key: read from the environment as `CALLE_API_KEY`. Never place it in intake JSON, logs, fixtures, or repository files.
- Allowlist the base URL. The key must never be sent to any other origin.

## Preflight

1. Confirm the user authorized this one qualification call and `consent` is `true`.
2. Confirm the phone is E.164 and came from the consent-gated lead record.
3. Optional but recommended: verify connectivity with the read-only goals endpoint.

```text
GET /v1/goals?limit=1
```

A non-2xx response stops the run. Do not dial.

## Plan (no call placed)

Build the goal text from the template in `SKILL.md`, then plan:

```bash
calle call plan \
  --to-phone <E164_PHONE> \
  --goal "<reviewed goal text>" \
  --timezone <IANA> \
  --language English \
  --region <REGION>
```

Review the returned plan, the task text, the result schema, the masked phone, and the idempotency key. Planning does not dial.

## Run (dials)

Only after a separate, explicit user confirmation:

```bash
calle call start --plan <plan_id> --confirm
```

Use exactly one call per lead per campaign. Preserve the idempotency key:

```text
lead_qualification:{lead_id}:{campaign_id}
```

## Status and reconciliation

```bash
calle call status --call <call_id>
```

Poll until a terminal state. Never automatically retry an error or an ambiguous timeout. An ambiguous create outcome is reported as "unknown and possibly created" and reconciled only with the **same** idempotency key.

Map terminal outcomes to the schema:

- Completed with transcript evidence: apply the fail-closed rules in `references/qualification-schema.md`.
- Voicemail detected: disposition `voicemail`.
- No answer / busy: disposition `no_answer`.
- Wrong number: disposition `wrong_number`.
- Failure or validation failure: disposition `needs_human`.

## Cancellation

Before `calle call start`: cancel by not executing. After a call is created, use provider cancellation only if available. Never redial automatically to "fix" an unknown result.

## Recurrence boundary

Do not create a provider-side recurring schedule, campaign queue, or daemon. If the team wants to re-qualify leads on a cadence, a host scheduler triggers this skill once per lead per cadence window.