# CALL-E ConsentGate

A consent-first preflight and audit layer for AI phone agents.

ConsentGate blocks a CALL-E request until the caller has supplied:

- a legitimate recipient source and consent basis;
- an opening disclosure that identifies the call as AI-generated;
- a recipient timezone and permitted calling window;
- a bounded retry policy;
- temporary rejection cooldowns plus permanent do-not-call suppression;
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
export CALLE_IDEMPOTENCY_NAMESPACE="your-stable-calle-project-id"
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
recipient's local window. Before the provider request, ConsentGate atomically
persists the exact request, its SHA-256 digest, and a content-bound idempotency
key bound to `CALLE_IDEMPOTENCY_NAMESPACE`. After create returns, it
checkpoints the accepted call ID before waiting.
The reservation counts against `max_attempts` and remains blocked for manual
reconciliation if either phase is interrupted:

```bash
python3 -m consent_gate execute plan.json \
  --state private/call-ledger.json \
  --confirm "I reviewed this call plan"
```

The live ledger contains the destination in the reserved provider request. Keep
it in a private directory with owner-only permissions; do not commit it.

To recover an interrupted dispatch, use the reservation ID from the ledger.
ConsentGate resumes both `accepted_waiting` and `reconciliation_required`
records by the accepted call ID when one was checkpointed. If create was
ambiguous, it replays the exact request with the same account-bound idempotency
key, never a new key:

```bash
python3 -m consent_gate reconcile plan.json \
  --state private/call-ledger.json \
  --reservation RESERVATION_ID \
  --confirm "I reviewed this call plan"
```

Because the current provider SDK does not expose verifiable recording and
retention controls, live execution also requires `recording: false` and
`retention_days: 0`.

ConsentGate distinguishes a request to end only the current call from an
explicit request for no future calls. A corroborated do-not-call request is
stored permanently and blocks every later attempt until a new verified opt-in
is recorded. A provider status or model-extracted field alone never changes
consent state: permanent suppression requires high-confidence task evidence
and a matching transcript statement. Completed outcomes similarly require
usable evidence and high confidence. `failed` and `no_answer` are retry-safe
only when terminal attempt records positively establish no contact and contain
no transcript; ambiguous or partial contact stays blocked for reconciliation.

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
