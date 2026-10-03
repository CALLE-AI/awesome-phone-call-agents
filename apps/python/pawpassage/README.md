# PawPassage

**Three frozen questions per service desk. One controlled CALL-E attempt. No invented travel clearance.**

PawPassage is an approval-gated evidence workbench for people coordinating a
cross-border journey with a companion animal. It contacts an airline,
veterinary service, or destination animal authority to check three exact
operational propositions, preserves contradictions, and produces a small
evidence matrix for a human to review.

It never books, pays, negotiates, gives medical or legal advice, certifies an
animal, or declares a journey safe or permitted.

## Why this exists

Cross-border pet moves often span three organizations whose written pages,
phone answers, service windows, and appointment rules may not line up. A
traveler can miss a cutoff even after reading every page they can find. A free
form phone agent would create a different problem: it might ask for sensitive
animal or owner records, accept a paid service, or turn an uncertain answer
into false confidence.

PawPassage narrows the call instead. Each checkpoint contains exactly three
pre-reviewed yes-or-no propositions grounded in an official HTTPS page. CALL-E
is used for the conversation and structured extraction. Local deterministic
code owns authorization, duplicate prevention, strict validation, and the
human-only decision boundary.

## Five-minute credential-free demo

Requirements: Python 3.11 or newer. No account, API key, phone number, paid
service, or network access is required after dependencies are installed.

PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e .
.\.venv\Scripts\python.exe -m pawpassage demo
```

macOS or Linux:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -e .
.venv/bin/python -m pawpassage demo
```

The demo starts a loopback-only CALL-E-shaped server, then sends requests
through the pinned official `calle-ai==0.7.0` SDK. It demonstrates:

1. an airline desk confirming all three propositions and offering a written
   reference;
2. a destination authority contradicting one frozen proposition; and
3. a simulated `503 provider_unavailable` during call creation, which becomes
   `SUBMISSION_UNKNOWN` and is never redialed.

It deliberately repeats the first and third execution requests. The durable
ledger blocks both duplicates. The generated reports are:

- `artifacts/pawpassage-demo-report.html` — a judge-friendly visual matrix;
- `artifacts/pawpassage-demo-report.json` — the same privacy-minimized evidence.

The report shows `realCalls: 0`, masks every phone number, and contains neither
the fake key nor any transcript.

## Run the tests

The suite is offline: it uses in-memory stubs and the local fake server only.

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

The current suite contains 58 tests covering closed input and result contracts,
approval invalidation, unsupported-region refusal, live-mode gates, SDK request
and response binding, malformed results, ambiguous creation, durable state
transitions, privacy minimization, and duplicate prevention.

The suite also checks recoverable read timeouts, mode isolation, Mandarin
consent and SDK routing, and the packaged demo from an unrelated directory.

It also checks sanitized first-rejection diagnostics, legacy ledger migration,
HTML escaping, and rejection persistence without redial after restart.

## Workflow

```text
closed journey case
        |
        v
masked exact preview + SHA-256 digest
        |
        v
human enters that exact digest
        |
        v
durable RESERVED intent (before network)
        |
        v
one CALL-E SDK create request ---- unknown result ---> SUBMISSION_UNKNOWN
        |                                      (no automatic redial)
        v
known call id -> SDK read/poll only
        |
        v
recipient/task/metadata/attempt binding checks
        |
        v
strict local result validation
        |
        +-- confirmed + written reference --> EVIDENCE_PACKET_READY
        +-- contradicted -------------------> GAPS_FOUND
        +-- missing/conflicting ------------> NEEDS_HUMAN_REVIEW
        +-- opt out or consent unconfirmed -> DO_NOT_CONTACT

Every branch stops at human review. No branch authorizes travel or another
external action.
```

## Closed checkpoint contract

Each checkpoint accepts only these fields:

- opaque case and checkpoint IDs;
- route label and broad animal category (`CAT`, `DOG`, or
  `OTHER_COMPANION_ANIMAL`);
- official service-desk label, HTTPS source page, exact E.164 number, documented
  CALL-E region, and locale;
- purpose-bound authorization basis and note; and
- exactly three propositions named `P1`, `P2`, and `P3`.

Names, home addresses, passport numbers, microchip numbers, medical records,
payment data, free-form notes, and extra fields are outside the contract.

The provider result is also closed. It contains one contact outcome, one role
match, three proposition outcomes, whether a written reference was offered, and
whether the conversation crossed a booking/payment boundary. Extra keys,
unknown enum values, and logical contradictions fail closed.

## Human approval flow

Use a private case file for any non-fictional recipient. `prepare` writes a
masked preview; it does not call anyone.

```powershell
.\.venv\Scripts\pawpassage.exe prepare `
  --case private\journey.json `
  --checkpoint AIRLINE_DESK `
  --output private\preview.json

$approvalDigest = (Get-Content -Raw private\preview.json | ConvertFrom-Json).approvalDigest

.\.venv\Scripts\pawpassage.exe approve `
  --case private\journey.json `
  --checkpoint AIRLINE_DESK `
  --digest $approvalDigest `
  --operator "reviewer-id" `
  --mode live `
  --output private\approval.json
```

Changing the phone, region, task, propositions, source page, schema, or safety
text changes the digest and invalidates the receipt. Live receipts expire after
15 minutes.

## CALL-E integration

PawPassage imports the official Python SDK as `from calle import CalleClient`.
The integration performs:

```python
client.calls.create(
    task=exact_approved_task,
    recipients=[{
        "phones": [exact_authorized_e164],
        "region": documented_region,
        "locale": documented_locale,
    }],
    recipient_result_schema=closed_schema,
    metadata=content_binding,
    idempotency_key=durable_intent_key,
)
```

After the returned call ID is durably recorded, the app uses
`client.calls.wait_for_result`. A create timeout, connection error, HTTP 408,
409, 429, or 5xx response is ambiguous because a call may have been accepted.
PawPassage records that uncertainty and does not call `create` again. Reads may
be resumed against the known call ID; a new call is never used as a status
check.

Returned task, metadata, recipient, phone, and attempt count must still match
the approved binding. A nominally completed result with a missing call ID,
different recipient, multiple attempts, failure code, missing structured
result, extra result field, or contradictory field is quarantined.

## Controlled live mode

**This command can place a real outbound call. Do not run it for the demo.**

Live mode requires all of the following at the same time:

- `CALLE_API_KEY` in the server environment, never a browser or case file;
- `PAWPASSAGE_LIVE_CALLS=ENABLED`;
- `PAWPASSAGE_ALLOWED_RECIPIENT_E164` exactly matching the reviewed case;
- the official `https://api.heycall-e.com` base URL (not configurable in live
  mode);
- a fresh, exact-content live approval receipt;
- a current timezone-aware call window no longer than four hours; and
- `--confirm-real-call I_APPROVE_ONE_REAL_CALL` on the command itself.

Example shape, intentionally without credentials or a real number:

```powershell
$env:PAWPASSAGE_LIVE_CALLS = "ENABLED"
$env:PAWPASSAGE_ALLOWED_RECIPIENT_E164 = "<AUTHORIZED_E164_PHONE>"
$env:CALLE_API_KEY = "<SERVER_SIDE_KEY>"

.\.venv\Scripts\pawpassage.exe execute-live `
  --case private\journey.json `
  --checkpoint AIRLINE_DESK `
  --approval private\approval.json `
  --ledger private\calls.sqlite3 `
  --window-start "<ISO_INSTANT_WITH_TIMEZONE>" `
  --window-end "<ISO_INSTANT_WITH_TIMEZONE>" `
  --confirm-real-call I_APPROVE_ONE_REAL_CALL
```

The application never reads a key in demo, preview, or approval mode.

### Read an existing call without redialing

A wait timeout or failed status read keeps a previously accepted call in
`ACCEPTED` with its known call ID. This command performs one SDK `get` request
and never creates a call:

```powershell
.\.venv\Scripts\pawpassage.exe reconcile-live `
  --case private\journey.json `
  --checkpoint MANDARIN_TEST `
  --approval private\approval.json `
  --ledger private\calls.sqlite3
```

The original content-bound receipt, existing ledger, API key and exact recipient
allowlist are required. The live call switch may stay disabled; an expired
call window or receipt does not prevent reading the same accepted call.
Content mismatches, unknown submissions, and quarantined results stay blocked.

### Consented Mandarin test

`examples/mandarin_smoke.template.json` is the selected test configuration:
Malaysia (`MY`, `+60`) with Mandarin (`zh-CN`). The consent opening and questions
are spoken in Mandarin. The recipient is explicitly a synthetic-test participant
and is never asked to represent a real airline or authority. The template has
an intentionally non-dialable placeholder; it does not assert consent.

On September 13, the production API rejected Malaysia / Mandarin before
dialing. A later, separately authorized US English official-hotline test
completed with `DO_NOT_CONTACT` because consent was not confirmed. See
[LIVE_VALIDATION.md](LIVE_VALIDATION.md). The Mandarin template remains a
non-dialable example, not a claim that this route currently works.

## Region honesty

An operator may run PawPassage from Hong Kong, Malaysia, or anywhere else. The
call destination must still be one of the region codes documented by CALL-E.
The current checked SDK documentation includes Malaysia (`MY`) but not Hong
Kong (`HK`). PawPassage therefore rejects `HK`; it never relabels a Hong Kong
number as Malaysia. A Hong Kong traveler can still use the workflow to contact
an authorized service desk in a supported destination or international support
region.

## Side effects, cancellation, and cleanup

- `demo`, `prepare`, and `approve` make no external call.
- `execute-live` creates at most one CALL-E call for one approved checkpoint.
- No recurring scheduler, booking, purchase, message, database integration, or
  source-system writeback exists.
- Before SDK submission, stop by not running `execute-live` or by letting the
  approval/window expire.
- The current Calls API exposes no client cancellation operation. Closing this
  app after CALL-E accepts a task stops local polling but does not cancel that
  call. Reconcile the known call ID; never redial to discover its outcome.
- Local reports and ledgers can be deleted under the deploying organization's
  retention policy. Deleting a ledger does not cancel a call and removes the
  local duplicate guard, so archive it through the provider's retry horizon.
- Set `PAWPASSAGE_LIVE_CALLS=DISABLED` and remove the server-side key and
  allowlisted number to disable future live calls.

## Privacy and trust boundary

The full destination is used only in the private input and the one SDK request.
The SQLite ledger and reports store a masked number plus hashes. Provider
transcripts and recordings are not persisted by this app. Structured results
are treated as untrusted until binding and closed-schema checks pass.

See [SAFETY.md](SAFETY.md), [ARCHITECTURE.md](ARCHITECTURE.md), and
[CONCEPT_AUDIT.md](CONCEPT_AUDIT.md) for the full boundaries and originality
review. [DEVPOST.md](DEVPOST.md) and [DEMO_SCRIPT.md](DEMO_SCRIPT.md) are ready
to adapt for submission.

## Known limitations

- English repository and demonstration; locale is passed through to CALL-E but
  multilingual call quality has not been validated here.
- Exactly three propositions and one recipient per checkpoint.
- One production US English official-hotline call completed; consent was not
  confirmed, so the app stopped and all three answers remained unestablished.
  This does not validate a real pet-service workflow or multilingual quality.
- No government, airline, veterinarian, or animal-health organization endorses
  this app.
- A phone answer may be mistaken or stale. The workflow intentionally asks only
  whether a written reference is offered and never stores a caller-supplied URL.
- A complete evidence packet is still only ready for human review.
