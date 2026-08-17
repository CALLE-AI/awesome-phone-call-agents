# CapacityLine CALL-E recovery example

CapacityLine is a consent-first supply recovery workflow that asks approved backup suppliers for live quantity, date, price, origin, certification, and authority facts. It returns a strict per-recipient result for a separate buyer-controlled qualification step.

This scoped CLI is the community-repository companion to the [CapacityLine web application](https://github.com/tsuchiyatakahirolab/capacityline). It demonstrates the CALL-E batch payload, evidence-oriented schema, idempotency, and safe preview behavior without requiring the full UI.

## Default dry run

```bash
npm install
npm run demo
```

The default uses fictional reserved sample numbers, masks them in output, prints the task preview, and creates **no call**.

## Live call side effect

Live mode creates real outbound CALL-E calls and may incur charges. Use only business contacts who explicitly expect the test. Phone numbers and credentials are read from environment variables and are never written to the repository or printed.

```bash
export CALLE_API_KEY="calle_live_key"
export CAPACITYLINE_CONFIRM_LIVE="YES"
export CAPACITYLINE_RUN_KEY="incident-017-attempt-1"
export CAPACITYLINE_RECIPIENTS_JSON='[
  {"id":"supplier-1","phone":"<AUTHORIZED_E164_PHONE>","region":"US","locale":"en-US"}
]'
npm run live
```

`CAPACITYLINE_RUN_KEY` should be persisted and reused for a retry of the same logical action. This protects against duplicate call creation after a network failure.

## Result handling

The example creates a CALL-E task and prints only its id, status, and recipient count. Use `client.calls.get(callId)` or the CALL-E CLI to read the result. An application should keep unknown/unreached separate from unavailable, evaluate buyer policy outside the conversation, and require a person before an RFQ or purchase workflow.

## Cancellation and rollback

This example creates a one-shot task and no recurring schedule. The SDK surface used here does not expose an app-level cancellation method. Restrict live tests to expected recipients, reuse idempotency keys, and use CALL-E account controls or its kill switch if an account-level stop is required. A completed call cannot be rolled back; downstream commercial action is deliberately not implemented.

## Credentials and data

- `CALLE_API_KEY` is read only in live mode.
- Live recipient JSON is read from the environment.
- Dry-run numbers are fictional North American `555-0100` examples and never dialed.
- Output excludes live phone numbers and transcripts.
- There are no schedules, background jobs, databases, or hidden side effects.

## Test

```bash
npm test
```
