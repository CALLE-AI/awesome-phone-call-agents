# Fake Provider and Closeout Workflow

## Status

The deterministic fake-provider workflow is implemented and verified against PostgreSQL 17. It exercises the same narrow `CallProvider` boundary planned for CALL-E but performs no network request and cannot place a phone call.

The browser interface exercises this workflow through the same authenticated
HTTP boundary and continues through the final human disposition. This document
describes the server-side fake-provider service and its persisted behavior.

## Application operations

`src/application/closeout-workflow.ts` exposes four bounded operations:

1. `createDemoCloseoutCase` validates fictional case input, encrypts the canonical E.164 number, stores its masked presentation form, and appends a redacted audit event.
2. `previewFakeCallBrief` rebuilds the approval-critical brief on the server and returns only a masked-number preview plus its SHA-256 digest.
3. `approveFakeAttempt` locks the case, verifies the reviewed version and brief digest, and creates exactly one attempt with exactly one approval.
4. `executeApprovedFakeAttempt` rechecks the approval, atomically claims the attempt, invokes only a provider identifying itself as `fake`, normalizes the result, and persists the resulting task and audit history.

All operations verify authenticated workspace membership. Creating, approving, or executing an attempt requires the `owner` or `operator` role. The workflow accepts only a `demo` workspace constrained to the fake provider with live calls disabled.

## Approval identity

The operator-visible preview and the provider-bound request serve different purposes:

- the preview contains the masked phone number and all conversational scope;
- the approval digest is calculated server-side from the same scope plus the canonical protected contact value, so a contact change invalidates approval;
- the provider request adds the server-created attempt identifier;
- the request fingerprint covers the complete provider-bound request;
- the idempotency key is derived once from the attempt identifier and is reused on every retry of that exact application command.

The browser cannot choose the attempt identifier, idempotency key, provider status, or approval truth.

## Duplicate prevention

Case and attempt rows are locked while approval and execution claims are evaluated. Repeating an approval for the unchanged current attempt returns the existing approval. Repeating execution after a stored result returns the existing attempt and result without invoking the provider again.

Before crossing the provider boundary, FieldClose durably claims provider creation by storing `requestedAt` and moving the case to `calling` inside the same locked transaction. A concurrent execution that observes a claim less than 60 seconds old returns `in_progress` without invoking the provider. After that lease, an explicit recovery may reuse the same provider idempotency key. Accepted, failed, and ambiguous updates are conditional on no outcome having been recorded, so a later writer returns the persisted state instead of overwriting it.

## Ambiguous creation

An ambiguous provider-creation outcome is not treated as failure. FieldClose:

- stores `ambiguous_requires_reconciliation`;
- preserves the absence of a provider call identifier instead of inventing one;
- moves the case to `needs_attention`;
- creates one `provider_reconciliation` task;
- records that retry is frozen in the audit event;
- returns the same frozen attempt on repeated execution.

The future CALL-E adapter must reconcile that original attempt before any new attempt can be approved.

## Result handling

The fake provider supports these deterministic scenario identifiers:

| Scenario | Persisted route or disposition |
| --- | --- |
| `resolved_clear` | `ready_for_closeout_review` |
| `issue_return_requested` | `return_visit_review` |
| `ambiguous_after_clarification` | `human_follow_up` |
| `wrong_person` | `human_follow_up` |
| `refused` | `human_follow_up` |
| `do_not_call` | `human_follow_up` plus a durable contact block |
| `no_answer` | `unreachable` |
| `voicemail` | `unreachable` |
| `technical_advice_requested` | `human_follow_up` |
| `commercial_commitment_requested` | `human_follow_up` |
| `malformed_provider_result` | `human_follow_up` with `result_validation_failed` |
| `creation_timeout_unknown` | `ambiguous_requires_reconciliation` |
| `duplicate_submit` | the existing attempt and result |

Provider task state remains separate from the FieldClose route. A provider task marked `completed` never changes a case to `closed`; it produces a human review task. Only later human disposition may close a case.

## Contact protection

Canonical numbers must arrive in explicit E.164 form. FieldClose stores:

- AES-256-GCM ciphertext with a fresh 96-bit initialization vector;
- the authentication tag and key version;
- a separate HMAC-SHA-256 lookup token;
- a presentation value that reveals only the final four digits.

Encryption and lookup keys must be different canonical base64-encoded 32-byte values. Plaintext is revealed only while the server reconstructs the approved provider request. It is not returned by case creation or preview and is not written to audit metadata.

## Verification evidence

The unit suite covers every deterministic result route, malformed output, ambiguous creation, do-not-call detection, encryption, masking, key separation, and E.164 rejection.

The PostgreSQL workflow suite proves:

- one repeated approval produces one attempt and one approval;
- repeated execution invokes provider creation once and stores one result and one task;
- unresolved work routes to return-visit review without confirming an appointment;
- a do-not-call request creates a durable contact block;
- malformed output becomes a bounded human review;
- ambiguous creation freezes provider resubmission and creates one reconciliation task;
- a proven pre-acceptance failure is stored separately from ambiguity;
- stale versions and changed brief hashes are rejected;
- normal returned values and audit metadata contain no canonical phone number.

Run the focused integration evidence with:

```bash
pnpm exec vitest run --config vitest.integration.config.ts tests/integration/closeout-workflow.test.ts
```

These tests use an isolated PostgreSQL 17 Testcontainers database and never use the development database.
