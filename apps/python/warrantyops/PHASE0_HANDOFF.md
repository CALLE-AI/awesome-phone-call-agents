# WarrantyOps Phase 0 handoff

> **Historical record — superseded.** This is the Phase 0 scaffold handoff
> for the pre-decision coverage/RMA hero. Its domain contract, test counts
> and status fields describe the former scaffold only. The current product
> is the v1 post-submission claim-exception contract; see `README.md` and
> `warrantyops/contract.py` in this directory. Retained unchanged as
> lineage, not as current instructions.

Everything a new executor needs to continue this contribution without the
conversation that produced it. Public-safe: no credentials, no real call
identifiers, no real phone numbers, no transcripts, no private paths.

## Purpose

A warranty exception is the claim that self-service could not settle: the
portal has no record of the serial, the form rejects the purchase date, the
email thread has gone quiet. The information needed to settle it exists, and it
is in the head of a person on a support line.

WarrantyOps makes that one call and returns the counterparty-stated status of
the claim, the reason it is being held, rejected, returned or left unpaid,
what they need from us, and — only when the counterparty confirmed a spoken
read-back — a claim, case or credit reference. Its governing rule is that the
result is allowed to be empty. An unknown labelled unknown is worth more than
a confident answer nobody gave.

Contribution: the portable skill `skills/warranty-recovery/` and the runnable
reference app `apps/python/warrantyops/`.

## Repository state

- Branch: `feat/warranty-recovery-scaffold`, forked from upstream `499a83c`.
- `9e5f07e` — Phase 0 scaffold.
- `f1263d0` — bind identifier confirmation to the exchange it answered.
- `HEAD` — approved short-confirmation fix and this handoff.
- Not pushed. No pull request open. Nothing rewritten.

Verification that must stay green:

```bash
python3 scripts/validate_repository.py                 # repository validator
python3 scripts/check_branch_name.py --branch <branch>  # branch naming
cd apps/python/warrantyops && python3 -m pytest         # the full suite, no fixed count
```

## Data zones

Two physically separate directories, siblings, never nested.

| | Public zone (this repository) | Private zone (outside any git tree) |
| --- | --- | --- |
| Phone numbers | reserved fictional 555-0100 to 555-0199 only | real authorized numbers |
| Transcripts | hand-written synthetic only | real transcripts |
| Call identifiers | `call_synthetic_*` only | real CALL-E call ids |
| API responses | none | raw responses |
| Credentials | none, ever | environment file, mode 600 |
| Recordings, logs | none | private artifact directory |

The separation is physical, not declarative. A `.gitignore` entry can be
overridden with `git add -f` and does not help for a path committed before the
entry existed. `warrantyops/config.py` refuses to start a live run whose
artifact directory resolves inside the repository.

If anything real ever reaches git: stop, do not "fix" it with a later commit
that deletes the file, and report it. The content stays reachable from the
earlier commit and shows in that commit's diff.

## Verified CALL-E facts

Read from the published documentation on 2026-09-01. Re-verify before relying
on any of it; that is the lesson of the next section.

- `POST /v1/calls`, `GET /v1/calls/{call_id}`, `GET /v1/calls/{call_id}/events`.
- `Idempotency-Key` header, 1-255 characters. Same key plus same body returns
  the original call — re-verified 2026-09-04 against the official Calls API
  page and the installed `calle-ai` 0.7.0 source (`calls.create` sends the
  key as the `Idempotency-Key` header). Same key plus different body is
  **not stated on the current documentation page** and stays UNKNOWN; the
  local attempt ledger remains the primary duplicate-call control and
  suppresses both cases by fingerprint comparison. Vendor replay is
  defence in depth only, and no runtime call has exercised it yet.
- Status enum: `queued`, `in_progress`, `completed`, `failed`, `canceled`.
- `result_schema` is validated server-side before a terminal call is returned.
  `structured_result` is null when no schema-valid task-level result could be
  produced, or when no schema was supplied.
- Documented schema subset: `type` (a single one of `object`, `string`,
  `number`, `integer`, `boolean`, `array`), `properties`, `required`, `enum`,
  nested objects, simple `array.items`, `description`,
  `additionalProperties: false`. Unsupported: `$ref`, `oneOf`, `anyOf`,
  `allOf`, recursive schemas, `additionalProperties: true`.
- Transcripts: `recipients[].attempts[].transcript_turns`, each turn carrying
  `offset_seconds`, `speaker` and `text`; `speaker` is `bot`, `user` or
  `unknown`; the array is empty when no transcript is available.
- Phone keypad IVR is supported, added 2026-08-15.
- No client-facing operation cancels a call once created.
- Webhook events `call.completed`, `call.failed`,
  `call.result_validation_failed`, delivered unsigned.
- Twenty-four stable API error codes in a `{"error": {code, message, details}}`
  envelope.
- `failure_code` on a call task is a nullable string with **no published
  enum**. The documentation states the Calls API does not guarantee a distinct
  no-answer or callee-decline value at call, recipient or attempt level, and
  instructs integrators not to branch retry, reporting or analytics on it.

## Assumptions proven false since the project started

Each of these was believed at some point and is wrong. They are listed because
the pattern matters more than the facts: inherited beliefs about a platform
decay quickly.

1. "CALL-E has no DTMF or IVR navigation." It does, since 2026-08-15.
2. "Transcripts are not exposed through the API." They are, per attempt, with
   speaker labels. The whole confirmation control depends on this.
3. "There is no way to know whether a call can be cancelled." The
   documentation is explicit that no cancel operation exists.
4. "`{\"type\": [\"string\", \"null\"]}` is fine because merged contributions use
   it." It is not documented. Convention in a repository is not a contract.
5. "Grounding a confirmation in an affirmative counterparty turn is enough."
   It is not. See the identifier section.

## Architecture

```text
apps/python/warrantyops/warrantyops/
  envelope.py       the source-claim record the gates decide on
  gates.py          residual necessity, economics, unchanged source
  contract.py       extraction schema, and the result the app will assert
  evidence.py       free-text values grounded in a counterparty turn
  identifiers.py    ABSENT / UNCONFIRMED / CONFIRMED, and the exchange binding
  outcome.py        transport state and business state, kept apart
  validation.py     the documented JSON Schema subset, re-checked locally
  authorization.py  who may be called, for what, until when, at which number
  idempotency.py    keys derived from the authorization, not the attempt
  ledger.py         the local attempt ledger: duplicate-call suppression
  disclosure.py     the allowlist of what may reach the call
  review.py         the packet a human sees, the decision a write-back demands
  writeback.py      deterministic write-back, refusing a moved source
  source.py         the read seam over the system of record
  config.py         dry run by default; the gates a live call must pass
  workflow.py       the order the stages run in
  providers/        base protocol, fake (default), CALL-E
```

Only `contract.py` knows what a warranty is. Everything else is
domain-independent, so the machinery survives a change of workflow. The
provider is an interface so that a change of transport is one new class.

## Domain contract

The current contract is **`warranty-claim-exception/v1`**: one submitted
claim exception, one call, one counterparty-stated answer.

`claim_status`: `STATED_REJECTED`, `STATED_RETURNED`, `STATED_IN_PROCESS`,
`STATED_PAID`, `UNKNOWN`. The first four are the counterparty's statement
about their own system, never an adjudication of the claim, and each requires
an evidence quote grounded in a counterparty turn that is neither hedged nor
non-final; otherwise the value is reduced to `UNKNOWN` and the reduction is
recorded in `downgrades` with the quote preserved for the reviewer.

Other fields: `stated_reason`, `required_correction`, `required_documents`,
`stated_deadline`, `escalation_path`, `stated_next_action`,
`confirmed_reference`, `evidence`, `downgrades`. Free-text values survive
only when found verbatim in a counterparty turn. Values are recorded exactly
as stated; a duration is never turned into a date.

Status and reference are independent. A representative can confirm a case
reference while hedging the status, so `UNKNOWN` status with a confirmed
reference is a valid result, not a contradiction.

**Superseded: the v0 coverage/RMA contract.** An earlier iteration of this
app returned `coverage_status` (`COVERED`/`NOT_COVERED`/`UNKNOWN`) and a
`resolution_status` (`RMA_ISSUED`, `REPLACEMENT_APPROVED`, `REPAIR_APPROVED`,
…) with an `authorization_reference`. That contract is gone; results under
the two contracts are not comparable, and the old five-fixture suite proves
nothing about this one. Anything in old notes describing coverage decisions
or RMA assertions describes v0.

## Transport state and business state

Different questions, separate objects.

| Terminal state | Meaning |
| --- | --- |
| `NOT_ATTEMPTED` | nothing was sent, or a gate refused before the call |
| `IN_FLIGHT` | the call has not reached a terminal state |
| `TRANSPORT_FAILED` | the call ended without completing (`failed`, `canceled`); no business outcome |
| `RESULT_UNAVAILABLE` | completed, no schema-valid structured result |
| `INFORMATION_OBTAINED` | a status, reason or reference was established |
| `ACTION_REQUIRED` | something specific is needed to move this |
| `BUSINESS_UNRESOLVED` | completed and settled nothing |

`TRANSPORT_FAILED` always carries `claim_status: UNKNOWN`. A call nobody
answered is not a claim status. `failure_code` is carried as
`diagnostic_failure_code` for support and never read; a test asserts that two
different failure strings produce byte-identical business results.

## High-consequence identifier confirmation

A claim, case or credit reference is not a fact about a conversation. It is a
pointer into the counterparty's system, and one wrong digit produces a result
that passes every schema check and is still false. This is the part of the
system most worth understanding, and the part most worth copying into an
unrelated workflow. (The v0 contract carried RMA numbers; the control is
reference-kind agnostic.)

States: `ABSENT`, `UNCONFIRMED_IDENTIFIER`, `CONFIRMED_IDENTIFIER`. Promotion
requires all of:

1. a confirmed value is present;
2. a read-back was performed and the counterparty responded to it;
3. the confirmation quote is affirmative, not a denial, not a hedge;
4. the quote is a whole counterparty turn, or a substring of one at least
   twelve characters long;
5. the confirmation **binds to the exchange the identifier was read back in**;
6. the confirmed value matches the expected shape.

Rule 5 is the one that matters. Rules 1 to 4 are what most workflows already
do, and together they are not enough:

```text
bot   "Is now a good moment for a couple of questions?"
user  "Yes, that is fine, go ahead."
```

That is a real, quotable, affirmative counterparty turn, and a workflow that
grounds a confirmation by searching for one will accept it as agreement to a
number nobody had mentioned. This defect was live in `9e5f07e` and fixed in
`f1263d0`.

Binding, concretely: the quote is located as a specific counterparty turn by
index; the agent turn it answered is the one immediately before it with no
other counterparty turn between; the confirmed value's digits must appear in
that pair, spelled or written. When another candidate was in play, only the
counterparty naming this one, and nothing else, resolves it. When the
counterparty contradicts the read-back, the agent's turn stops being
admissible, so a correction cannot confirm the value it corrected.

Short replies get stricter treatment, because they carry no words of their own:
a bare "Correct." must be the whole turn, must immediately answer a read-back
that put exactly one identifier in front of the counterparty, and — since the
same string can occur several times in one call — every occurrence must bind to
the same identifier or none of them counts.

Refusal is always available, and is the right answer more often than not:
`NO_READBACK`, `QUOTE_HEDGED`, `QUOTE_NEGATED`, `QUOTE_TOO_SHORT`,
`QUOTE_NOT_IN_COUNTERPARTY_TURN`, `IDENTIFIER_NOT_IN_EXCHANGE`,
`AMBIGUOUS_EXCHANGE`, `TRANSCRIPT_UNAVAILABLE`, `PATTERN_MISMATCH`.

No transcript means no confirmed identifier, ever. Without one there is no way
to know what the counterparty was agreeing to.

### Why model confidence is never sufficient

A confidence score measures how sure a model is about what it heard. It says
nothing about whether what it heard is what was meant. The two failures that
matter here are a misheard digit and a value the counterparty later corrected,
and those are exactly the cases a confident extraction gets wrong.

So confidence is not an input. `evaluate_identifier` takes no confidence
argument, and a test asserts that by inspecting the function signature. There
is nothing a caller can pass that substitutes for the read-back.

## Schema rules and optional fields

The schema sent as `result_schema` uses only documented features.
`documented_schema_violations()` guards it and a test asserts the result is
empty, so a dependency on something undocumented fails locally rather than as a
rejected call.

Optional fields are declared as plain strings and kept out of `required`, with
descriptions instructing the model to **omit** the field when nothing was
stated. `{"type": ["string", "null"]}` is not documented, whatever merged
contributions do. Local validation still accepts a null for an optional field,
so a provider that returns one does not fail the whole result.

Enum selection rules live in `description`, as the documentation advises, and
every enum includes an explicit not-established member.

## Authorization gate

No call is placed without a record naming the recipient, the basis, the
purpose, who granted it, when, and when it expires. Accepted bases:
`OWNED_NUMBER`, `WRITTEN_CONSENT`, `EXISTING_SERVICE_RELATIONSHIP`,
`TEST_RECIPIENT_CONSENT`.

The record itself never enters the repository; the workflow holds a pointer to
where it is filed. Refusals are named, not summed: `INVALID_E164`,
`MISSING_PURPOSE`, `PURPOSE_MISMATCH`, `EXPIRED`, `NOT_YET_VALID`,
`MISSING_RECORD_REFERENCE`, `RECIPIENT_NOT_ALLOWLISTED`,
`AUTHORIZED_RECIPIENT_MISMATCH`.

The authorization is also bound to a destination: after normalization, the
authorized recipient must equal the claim's `counterparty_phone_e164`. A
record that permits calling one number is never permission to dial a
different claim's counterparty, so a mismatch refuses with zero provider
interactions rather than trusting the provider to notice.

Numbers are validated against the stricter of the two E.164 patterns CALL-E
publishes, and masked in every output a human or a log will see.

## Idempotency and duplicate-call suppression

Duplicate calls are prevented **locally, before the provider**. Immediately
before `place_call`, the workflow reserves the idempotency key and a
fingerprint of the exact request in an attempt ledger
(`warrantyops/ledger.py`), atomically. Only a reservation the current run
created may reach the provider; an existing reservation in any state
(`RESERVED`, `COMPLETED`, `UNKNOWN`) refuses with
`DUPLICATE_CALL_SUPPRESSED` (same fingerprint) or `IDEMPOTENCY_CONFLICT`
(different body), with zero provider interactions. An unavailable or missing
ledger is `ATTEMPT_LEDGER_UNAVAILABLE` — the reservation is mandatory and
fails closed.

The ledger is deliberately minimal: key, fingerprint, state, timestamps,
and the vendor call id once creation succeeds (persisted between creation
and the first status read, so a crash in between stays reconcilable). No
phone number, transcript, claim text or credential is ever stored. The
durable implementation is SQLite at an explicit user-state path, refused
inside the repository; the in-memory implementation is legal only next to
the fake provider, and a provider declaring live capability refuses a
non-durable ledger (`LEDGER_NOT_DURABLE`).

An attempt whose outcome could not be determined — the provider raised, or
returned before a terminal state — is marked `UNKNOWN` and is **never
retried automatically**. Reconciling whether that call happened is a human
task against the vendor's records; a new attempt needs a new source version
and therefore a new key. A crash after reservation leaves the committed row,
which is itself the suppression.

Keys are still derived deterministically from the authorization record, the
claim and its source version, and the contract version — properties of what
was authorized, never of the attempt — and the key is still sent to CALL-E
on the one permitted request. That is defence in depth only: the vendor's
same-key replay guarantee is documented but has never been exercised at
runtime by this project and is treated as **UNKNOWN** until the Runtime
Proof verifies it. A deliberate re-check must pass an explicit token,
because reusing the original key would return the very answer being
re-checked.

The source version under a key is live, not assumed: the current version is
re-read through a supplied reader before dialing, and write-back re-reads it
again immediately before mutating. A missing reader is itself a named refusal
(`SOURCE_RECHECK_UNAVAILABLE`) with zero provider interactions — the check is
mandatory and is never silently skipped.

## The live adapter and the SDK

The live CALL-E adapter (`providers/calle_client.py`) is written against
the **installed SDK source**, `calle-ai==0.7.0` (pinned in `pyproject.toml`
for reproducibility), read in the isolated environment
`/private/tmp/warrantyops-live-venv` on 2026-09-04. Verified from that
source: `CalleClient(api_key, base_url, timeout)` is a context manager;
`calls.create(*, task, recipients, result_schema, metadata,
idempotency_key, …)` and `calls.get(call_id)` return plain `dict`s;
`CallStatus` is `queued|in_progress|completed|failed|canceled`;
`TranscriptSpeaker` includes `unknown` alongside `bot` and `user`; errors
are `CalleAPIError` (with `code`, `status_code`), `CalleTimeoutError`,
`CalleConnectionError`. The SDK ships `calls.wait_for_result`, but it
sleeps on the real clock, so the adapter polls `calls.get` itself with an
injectable clock, a wall-clock deadline and no invented cancellation. The
vendor call id is persisted to the attempt ledger between creation and the
first status read. The SDK requires **Python 3.11+**; the adapter imports
it lazily so the 3.9-compatible core never needs it. Same-key/different-body
idempotency conflict semantics and rate limits remain runtime-only
unknowns.

## Dry run and the fake provider

Dry run is the default and live is not a flag: the command line can only
construct the fake provider. A live run needs `CALLE_LIVE_CALLS_ENABLED=1`, an
API key, an official CALL-E origin, an artifact directory outside this
repository, and a passing authorization gate. Any one missing is a refusal.

```bash
cd apps/python/warrantyops
python3 -m warrantyops --list
python3 -m warrantyops --scenario case_d_corrected_reference
# durable duplicate suppression demo (explicit user-state path, outside the repo):
python3 -m warrantyops --scenario case_a_useful_resolution --ledger-db /tmp/warrantyops-attempts.sqlite
python3 -m warrantyops --scenario case_a_useful_resolution --ledger-db /tmp/warrantyops-attempts.sqlite  # DUPLICATE_CALL_SUPPRESSED
```

Six synthetic scenarios in `fixtures/`, and exactly six — a test asserts the
set by name:

- `case_a_useful_resolution` — status, reason, documents, deadline and a
  confirmed case reference.
- `case_b_source_sufficient` — the portal already states the next step; the
  residual gate refuses and the provider is never invoked.
- `case_c_missing_documents` — documents requested; status stays `UNKNOWN`,
  terminal state `ACTION_REQUIRED`.
- `case_d_corrected_reference` — a misheard reference caught by the read-back;
  only the corrected value is asserted.
- `case_e_no_result` — the call completed but produced no schema-valid
  result; nothing is written.
- `case_f_source_changed` — the source record moved between call and
  write-back; the write-back refuses.

Each declares the outcome it expects and a test asserts the code produces it.
Every fixture reports `real_calls_placed: 0`. (Superseded: an earlier
five-fixture set — clean success, documentation request, hedged answer,
misheard reference, incomplete call — belonged to the v0 contract; the
hedged-answer and incomplete-call behaviours are now pinned by unit tests in
`test_outcome.py` rather than by fixtures.)

## Tests, and what they prove

The full suite (no count is pinned here; run it). What they are for:

- `test_identifiers.py` — the confirmation control and the attacks on it,
  including the "yes to an earlier question" defect, hedges, corrections
  without a second read-back, two numbers in one read-back, a case number
  confirmation reused for a credit note, the agent's own read-back quoted as
  agreement, a repeated short reply, and a missing transcript.
- `test_outcome.py` — a failed or canceled call never becomes a claim status;
  two different `failure_code` strings produce identical business results; a
  hedged or non-final status quote is deterministically reduced to `UNKNOWN`
  with the quote preserved; a clear grounded status survives.
- `test_validation.py` — malformed results rejected, `UNKNOWN` preserved
  exactly, a null structured result treated as a state rather than an error.
- `test_contract.py` — the schema is closed, complete, and free of undocumented
  features.
- `test_gates.py` — authorization refusals, destination normalization, and
  idempotency determinism.
- `test_envelope.py` — the source-claim record refuses rather than defaults.
- `test_pre_call.py` — residual necessity, organization-owned economics,
  disclosure allowlist, and the source-version re-read.
- `test_workflow_guards.py` — a missing version reader or a destination
  mismatch refuses with zero provider interactions; one run is one provider
  interaction; one shared ledger across two runs is one total interaction.
- `test_attempt_ledger.py` — the local duplicate-call control: shared-ledger
  single interaction, SQLite restart suppression, `IDEMPOTENCY_CONFLICT`,
  `UNKNOWN` after provider error with retry suppression, fail-closed
  unavailable ledger, durable-ledger requirement for live-capable providers,
  and a byte-level audit that no sensitive field is stored.
- `test_calle_adapter.py` — the live adapter against mocked SDK 0.7.0
  shapes: creation-before-first-read call-id persistence, dict handling,
  bounded polling to every terminal status, malformed-id failure, deadline
  and error paths to UNKNOWN, exactly one creation, context-manager
  lifecycle, safe diagnostics.
- `test_dry_run.py` — zero calls with sockets patched to raise, live gates,
  artifact directory refused inside the repository, transcript read from the
  correct attempt.
- `test_scenarios.py` — the six fixtures run end to end and match their
  declared outcomes, including the CLI surface.
- `test_review_writeback.py` — review gate, bounded note, semantic
  idempotency, stale-source refusal.
- `test_repo_hygiene.py` — reserved numbers only, no credential-shaped strings,
  synthetic call identifiers only.

## Repository hygiene

Every number in this contribution is from the reserved fictional 555-0100 to
555-0199 block; a test fails the suite if that stops being true. A separate
audit tool, kept in the private zone, scans the working tree, the git index and
commit history, separating findings introduced by this branch from upstream
ones. It is wired as a local pre-commit hook that lives inside `.git/` and is
therefore never part of this contribution.

## Goal Runs status

`POST /v1/goals/{goal_id}/runs` requires an `Idempotency-Key` and accepts only
`phone` and `variables`. `GoalRunError.code` is a real enum — `call_failed`,
`no_answer`, `declined`, `timed_out`, `canceled`, `result_invalid`,
`result_unavailable`, `result_failed` — which is the one thing the Calls API
does not offer.

Two documented properties decide against it for now. Goal authoring and
publication are not Developer API operations, so the prompt and schema would
live in a dashboard rather than in version control where a reviewer can read
them. And a run request may not supply a task, schema or RunSpec selector
(`schema_override_not_allowed`), so the extraction contract could not be
changed in a pull request. It is also unknown whether a Goal Run result exposes
transcripts; without them the confirmation control cannot run at all.

**Status: the Calls API is the baseline.** A read-only spike exists in the
private zone; it uses two GET endpoints, places zero calls, refuses
unofficial origins and never prints a credential. Investigation budget is
capped at 60 minutes. The project does not depend on the outcome.

## Test 1 — cooperative, pass and fail

One authorized call to a number the operator owns, or a person who explicitly
agreed. The recipient plays a cooperative warranty desk: states the claim
status in their system, gives the reason it is held, asks for a document,
states a deadline, confirms a case reference when it is read back, and
declines to give anything further.

Pass requires all of: the call reached `completed`; `structured_result` was not
null; local validation passed; the identifier reached `CONFIRMED_IDENTIFIER`;
the confirmation quote appears in a `user` transcript turn; and the derived
status, stated fields and reference match what the recipient actually said.

A failure of the first three is a platform finding worth recording. A failure
of the last three is a defect in this workflow.

## Test 2 — adversarial, pass and fail

An authorized recipient who is deliberately difficult: partial answers, one
interruption, background noise, one hedged answer, a documentation request, a
reference stated once and quickly, not repeated unless read back, and corrected
if the read-back is wrong. The recipient writes down what they actually said
before any output is examined.

**Pass is not schema-valid JSON.** Pass is that the final business state and
the critical identifier match what the recipient said and confirmed. A hedge
must not become a definitive `claim_status`. A decoy case number must not
become the confirmed reference. The value first heard must not survive a
correction.

Outcomes are recorded as one of: CORRECT; CORRECTLY UNRESOLVED (the workflow
refused to assert something it could not establish, and was right to); SILENT
ERROR (schema-valid and factually wrong — a stop condition, not a bug to note);
LOUD ERROR (failed visibly, cheap, record the cause).

## Known UNKNOWNs

1. Goal Runs reachability for this account. Spike written, not yet run.
2. Whether a Goal Run result exposes transcripts or attempts.
3. Whether a model asked to omit an optional field omits it or returns null.
   Both are handled; this is a question about which branch is exercised.
4. **Everything above is synthetic.** The whole suite runs against
   transcripts written by hand. No real call has been placed. This is the
   largest unknown by far, and the only one that a test suite cannot reduce.
5. **The vendor's same-key replay guarantee.** Documented, never exercised.
   Duplicate calls are suppressed locally by the attempt ledger; the key on
   the wire is defence in depth only.

## Deadlines

- **Sep 5, 2026** — target date to open the public pull request.
- **Sep 7, 2026** — absolute latest to open it.
- **Sep 14, 2026** — submission deadline. An open pull request is acceptable;
  an open pull request visibly carrying unresolved maintainer "Must Fix"
  blockers is not.

## Next five actions, in order

1. Run the read-only Goal Runs spike. Decide `USEFUL FOR PHASE 1` or `STAY WITH
   CALLS API` and stop. 60 minutes maximum.
2. Run Test 1 against an owned number. Compare transcript, extracted output and
   asserted business result by hand. Run the hygiene audit afterwards.
3. Run Test 2 with an authorized adversarial recipient and a pre-written answer
   key. This is the strongest technical evidence the project can produce.
4. Maintain passive collision and adoption monitoring from official
   documentation, current products, public customer behaviour, app reviews and
   forums. Do not conduct interviews, surveys, focus groups or hired human
   review for this strategy lock, and do not reopen the concept unless a kill
   gate fires.
5. Open the pull request, by Sep 5 and no later than Sep 7.

## DO NOT REOPEN WITHOUT REAL EVIDENCE

Frozen unless a real CALL-E test, maintainer review, or primary research
disproves them. Re-litigating any of these from taste alone costs days the
schedule does not have.

- **Public and private artifact separation.** Two physically separate
  directories. Not a `.gitignore` rule.
- **The Calls API is the baseline**, until Goal Runs demonstrably does better
  on a real call, including exposing something the confirmation control can
  bind to.
- **No real-call artifact in git.** No transcripts, call identifiers, raw
  responses, recordings or unmasked numbers, not even temporarily.
- **No dialling a number the workflow was not given**, and none without a live
  authorization record. No discovery, no sweeps, no second leg.
- **Transport state and business state stay separate.** A failed call never
  produces a coverage decision, and `failure_code` is never branched on.
- **A high-consequence identifier requires an explicit read-back bound to its
  own exchange.** Extraction confidence is not an input and must not become
  one.
- **UNKNOWN beats invented.** Every enum keeps its not-established member, and
  a value with no evidence is downgraded rather than reported.
- **No polished UI, dashboard, authentication, CRM integration, billing,
  multi-call chains or agent builder** until the business and technical gates
  have both passed.
- **A search result of “nothing found” describes the tool's reach, not the
  world.** Before that result can move a product decision, verify it by a
  second independent search method and record both scopes.

## ESCALATE TO A STRONG REASONING MODEL ONLY IF

Routine work — fixture expansion, test additions, documentation edits,
mechanical refactors that change no control — does not need one. These do:

- A **real transcript contradicts the confirmation model**: the counterparty
  clearly confirmed and the workflow refused, or the workflow confirmed
  something the recipient did not say.
- CALL-E returns a **schema-valid but factually wrong** structured result, in
  any field.
- **Test 2 exposes a silent identifier error.** Stop everything else.
- **Goal Runs behaves materially differently** on transcripts, errors or
  idempotency in a way that would change the transport decision.
- **Maintainer feedback requires an architectural change**, as opposed to a
  rename, a documentation fix or a reserved-number correction.
- **Public customer-behaviour evidence or an authorized real test invalidates
  the workflow**, for instance if portals and email already settle the target
  exceptions without meaningful delay or ambiguity.
- A **credential, transcript, real number or call identifier reaches git**.
  History remediation is never a mechanical fix.
