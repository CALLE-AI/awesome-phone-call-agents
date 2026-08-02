# CALL-E ConsentGate

A consent-first preflight and audit layer for AI phone agents.

ConsentGate blocks a CALL-E request until the caller has supplied:

- a legitimate recipient source and consent basis;
- an opening disclosure that identifies the call as AI-generated;
- a recipient timezone and permitted calling window;
- a bounded retry policy;
- a 24-hour suppression period after the recipient rejects a call;
- explicit recording and retention choices; and
- a human-readable purpose that does not request secrets.

The default workflow is entirely offline. It validates a JSON plan, prints a
redacted audit manifest, and never places a call. Live execution is deliberately
separate and requires the `execute` command plus either `CALLE_API_KEY` or
`CALLE_API_KEY_FILE`.

## Demo video

The public 1080p demonstration uses the privacy-safe offline simulator and
honestly reports the unsuccessful CN-region API test: no call ID was created
and no call was placed.

https://github.com/ILoveBuns/calle-consent-gate/releases/download/v0.1.0-demo/consentgate-demo-1080p-with-voice.mp4

## Quick start

```bash
python3 -m consent_gate validate examples/consented_test_call.json
python3 -m consent_gate manifest examples/consented_test_call.json
python3 -m consent_gate simulate examples/consented_test_call.json
python3 -m unittest discover -s tests -v
```

The example contains a placeholder number and cannot be executed.

`simulate` is deterministic and fully offline. It produces a redacted
manifest, a sample transcript, and a structured result while explicitly
reporting that no network was used and no call was placed.

## Live execution

Live use is intentionally guarded:

```bash
export CALLE_API_KEY_FILE="/path/to/restricted/calle-api-key"
python3 -m consent_gate execute plan.json --confirm "I reviewed this call plan"
```

Execution imports the official `calle-ai` SDK only after all checks pass. The
recipient phone is never written to the audit manifest; it is represented by a
short SHA-256 fingerprint.

A live plan must also contain `"execution_allowed": true`. The bundled example
omits this flag, so it can be validated and inspected but never dispatched.

The key file should be readable only by the current user (mode `600`). Using a
key file keeps the secret out of shell history and process environment output.

Pass a redacted outcome ledger when validating or executing:

```bash
python3 -m consent_gate validate plan.json --history call-history.json
```

Live execution requires a durable ledger and refuses to dispatch outside the
recipient's local window. A reservation is atomically persisted before the
provider request, counts against `max_attempts`, and remains blocked for manual
reconciliation if the request is interrupted:

```bash
python3 -m consent_gate execute plan.json \
  --state private/call-ledger.json \
  --confirm "I reviewed this call plan"
```

Because the current provider SDK does not expose verifiable recording and
retention controls, live execution also requires `recording: false` and
`retention_days: 0`.

If that phone fingerprint has a `rejected` event less than 24 hours old,
ConsentGate blocks the call and reports the earliest permitted retry time.
Recipient refusal is derived from the structured reachability result even when
the provider reports a completed call. A completed status without verified
reachability remains blocked for manual reconciliation rather than permitting a
retry.

Only call a number you control or a recipient who has explicitly agreed to the
call. Comply with applicable calling, recording, privacy, and consumer
protection laws.

## Design

ConsentGate separates three concerns:

1. `validate`: deterministic policy checks with no network access.
2. `manifest`: a redacted, reproducible record of what was approved.
3. `simulate`: an offline end-to-end demonstration using the same policy gate.
4. `execute`: an explicit boundary that invokes CALL-E only after validation
   and human confirmation.

This prototype does not claim that a checklist makes a call legally compliant.
It is a safety control that makes missing decisions visible before dispatch.
