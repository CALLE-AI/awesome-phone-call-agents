# CALL-E ConsentGate

A consent-first preflight and audit layer for AI phone agents.

ConsentGate blocks a CALL-E request until the caller has supplied:

- a legitimate recipient source and consent basis;
- a purpose-bound, fixed opening disclosure that identifies the call as
  AI-generated without accepting caller-controlled instructions;
- a recipient timezone and permitted calling window;
- a bounded retry policy;
- temporary rejection cooldowns plus permanent do-not-call suppression;
- explicit recording and retention choices; and
- an approved low-risk `purpose_kind` whose exact, fixed template does not
  request secrets or contain medical, legal, financial, or emergency content.

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
key bound to `CALLE_IDEMPOTENCY_NAMESPACE` and the persisted attempt number.
An ambiguous create is reconciled with the same key; only a separately
authorized attempt after a known terminal outcome receives the next attempt
number and a distinct key. After create returns, ConsentGate
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
ConsentGate can reconcile `dispatching`, `accepted_waiting`, and
`reconciliation_required` records. It resumes by the accepted call ID when one
was checkpointed. If the process stopped before that checkpoint or create was
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

### Cancellation and scheduling

Every `execute` invocation submits at most one immediate, one-off provider
request. ConsentGate has no scheduler integration and never creates recurring
jobs, background redials, or hidden schedules. A later attempt requires another
explicit command (or a separately visible, user-approved host scheduler) and
must pass the durable cooldown, attempt, and consent gates again.

Once CALL-E has accepted a request, version 0.2.0 of the official SDK exposes
no operator-side cancel endpoint. Pressing Ctrl-C only stops the local waiter;
it does **not** cancel the accepted call, and the durable reservation remains
blocked until `reconcile` records the terminal result. The recipient can cancel
the active call by saying “end this call” or “hang up”; the bound task requires
the agent to acknowledge that request and end immediately. If an operator-side
kill switch is required, do not use live execution until the provider offers a
verifiable cancellation control.

ConsentGate distinguishes a request to end only the current call from an
explicit request for no future calls. A corroborated do-not-call request is
stored permanently and blocks every later attempt until a new verified opt-in
is recorded. A provider status or model-extracted field alone never changes
consent state: permanent suppression requires high-confidence task evidence
and a matching transcript statement. Completed outcomes similarly require
usable evidence and high confidence. `failed` and `no_answer` are retry-safe
only when terminal attempt records positively establish no contact and contain
no transcript; ambiguous or partial contact stays blocked for reconciliation.
A corroborated request to end only the current call is stored as a temporary
rejection and starts the 24-hour cooldown; an uncorroborated or low-confidence
extraction remains blocked for reconciliation.

A verified completed call is final and cannot consume a second attempt. A new
attempt is permitted only after the previous reservation has a retry-safe
terminal outcome (`no_answer`, `failed`, or a temporary `rejected` outcome
after its cooldown). `max_attempts` is an upper bound, not permission to repeat
an already successful or ambiguous call.

The audit manifest is constructed from a fixed schema of validated operational
fields. Unknown top-level fields and unknown nested fields are omitted rather
than copied, so plan extensions cannot leak tokens, alternate phone numbers, or
private operator context into supposedly redacted output.

Caller-controlled purpose prose is never inserted into a live task. A plan must
select an allowlisted `purpose_kind`, and its human-readable `purpose` must
exactly match that kind's fixed template. Calls containing medical, legal,
financial, or emergency content are rejected rather than delegated to the
model. This version intentionally allowlists only the bundled, consented
`accessibility_test`; adding another purpose requires a reviewed code change,
template, and tests.

Caller-controlled disclosure prose is also never inserted into a live task.
Each approved `purpose_kind` owns one exact disclosure template; both the plan
validator and the live request builder enforce that binding. Adding or changing
a disclosure requires the same reviewed code and regression-test process.

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
