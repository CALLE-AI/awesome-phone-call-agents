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

## Quick start

```bash
cd apps/python/consent-gate
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
python3 -m pip install -e '.[live]'
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

If that phone fingerprint has a `rejected` event less than 24 hours old,
ConsentGate blocks the call and reports the earliest permitted retry time.

Only call a number you control or a recipient who has explicitly agreed to the
call. Comply with applicable calling, recording, privacy, and consumer
protection laws.

## Side effects and cancellation

`validate`, `manifest`, and `simulate` are offline and never create a call.
`execute` creates one real outbound CALL-E call after every policy check, the
`execution_allowed` flag, and exact human confirmation succeed. It creates no
recurring schedule.

Before dispatch, cancel by omitting `execute`, `execution_allowed`, or the
confirmation phrase. After CALL-E accepts the call, ConsentGate cannot
guarantee cancellation; use provider controls if available. A recipient can
decline or hang up, and recording stays disabled unless the plan includes
explicit recording consent.

Do not use this example for emergency, medical, legal, financial, political,
collections, or unsolicited marketing calls.

## Compatibility

- Python 3.11 or later
- `calle-ai==0.2.0` for opt-in live execution
- CALL-E regions and languages listed by the provider

## Design

ConsentGate separates three concerns:

1. `validate`: deterministic policy checks with no network access.
2. `manifest`: a redacted, reproducible record of what was approved.
3. `simulate`: an offline end-to-end demonstration using the same policy gate.
4. `execute`: an explicit boundary that invokes CALL-E only after validation
   and human confirmation.

This prototype does not claim that a checklist makes a call legally compliant.
It is a safety control that makes missing decisions visible before dispatch.
