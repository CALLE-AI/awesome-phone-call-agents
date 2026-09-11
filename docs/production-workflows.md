# Production Phone-Call Workflows

Phone calls are one step in a business workflow, not the workflow's source of
truth. CALL-E executes and reports calls. The integrating application owns the
business intent, authorization, idempotency, state transitions, retry policy,
and audit history around those calls.

This guide describes a framework-neutral production pattern. It does not add a
CALL-E API endpoint, promise that a local check will predict provider
acceptance, or turn the repository's demo apps into supported SDKs.

## Reference architecture

```text
authorized business intent
        |
        v
durable intent + stable idempotency key
        |
        v
dispatcher ---------> CALL-E Calls API
        |                    |
        |                    v
        |             call execution state
        |                    |
        v                    v
application record    webhook / status signal
        ^                    |
        |                    v
        +----- durable inbox or queue
                             |
                             v
                    reconciliation worker
                             |
                             v
                  policy and evidence gate
                             |
                  +----------+----------+
                  |                     |
                  v                     v
          business transition      human review
```

The application should be able to reconstruct every transition from durable
state after a process crash. A webhook can wake the worker, but it must not be
the only record that a call or business transition exists.

## Keep application state separate from call state

Use application-local states that describe what the workflow knows. Do not
collapse them into CALL-E's call lifecycle statuses.

| Example application state | Meaning | Allowed next step |
| --- | --- | --- |
| `reserved` | The authorized intent and stable idempotency key are durable; no acceptance is known. | Submit the exact reserved intent. |
| `submission_unknown` | The request left the client, but acceptance is unknown. | Reconcile; do not create a new intent or redial. |
| `accepted` | An authoritative call ID is stored and bound to the intent. | Observe or poll the same call. |
| `terminal_unverified` | A notification or read suggests a terminal result, but binding and evidence checks are incomplete. | Fetch and verify authoritative state. |
| `terminal_verified` | The terminal snapshot matches the reserved intent and passes the result policy. | Evaluate the separate business transition. |
| `needs_human` | The outcome, binding, evidence, or policy is ambiguous or contradictory. | Stop automation and reconcile manually. |
| `applied` | An allowed business transition was committed idempotently and recorded. | No second application of the same transition. |

These names are examples, not CALL-E response values. Use names that fit the
host application's domain while preserving the distinction between unknown,
unverified, verified, and applied.

## 1. Reserve intent before submission

Persist the business intent before crossing the real-call boundary. The record
should include:

- an opaque intent or workflow identifier;
- the purpose-bound authorization and its validity window;
- an access-controlled reference to the exact approved destination;
- the task and result-schema versions;
- a stable idempotency key derived from the authorized intent, not an attempt;
- the current application state and transition timestamps; and
- the policy that will decide whether a verified result may drive a business
  action.

The full destination may be necessary inside an access-controlled contact
record. Logs, user-visible summaries, and general audit tables should use an
opaque contact identifier or a masked destination instead.

See the detailed [idempotency reference](../skills/service-dispatch-call/references/idempotency.md)
for reservation order, key stability, and webhook replay safety.

## 2. Run a no-call preflight

Validate everything that can be checked before reading CALL-E credentials or
crossing the real-call boundary:

- the recipient and purpose match the recorded authorization;
- the destination is valid E.164 and is not guessed or silently repaired;
- required task inputs are present and bounded;
- the transmitted result schema uses the currently documented supported
  subset, while stricter local validation remains available after the call;
- the idempotency key and application record already exist;
- the preview contains no credentials, private transcript, or unnecessary
  personal data; and
- the downstream policy identifies which outcomes require human review.

Use the [result schema reference](../skills/service-dispatch-call/references/result-schema.md)
as the source of truth for transmitted versus strict local validation, bounded
fields, partial or invalid results, and schema versioning.

A preflight is an application-side safety check. It is not a promise that
CALL-E or an upstream carrier will accept the request, and this guide does not
imply that a dedicated no-call validation API exists.

## 3. Submit once and reconcile ambiguity

After submission starts, distinguish a confirmed rejection from an unknown
outcome. A client timeout or connection loss says what the client observed; it
does not prove that no call was accepted.

1. Submit the exact durable intent with its stable idempotency key.
2. If the response returns an authoritative call ID, bind it to the intent in
   durable storage.
3. If the submission outcome is unknown, record `submission_unknown` and stop
   automatic call creation.
4. Use the current documented lookup or idempotent recovery contract when one
   is available. Never invent a new key or a new intent merely to retry.
5. If deterministic recovery is unavailable, route the record to an operator
   rather than risk a duplicate call.

The [ambiguous-outcome guide](../skills/service-dispatch-call/references/ambiguous-outcomes.md)
explains why unknown is a state to reconcile rather than an error to retry.

## 4. Receive events through a durable inbox

Design for at-least-once delivery. A safe webhook path separates quick durable
receipt from slower reconciliation and business processing.

```text
webhook handler transaction
  validate the envelope and bounded identifiers
  insert one inbox row under a unique event identifier
  commit
return the documented success response

worker
  claim the inbox row idempotently
  fetch the authoritative call snapshot
  verify call, workflow, and intent bindings
  append the application transition
  commit the transition and processed marker together
```

The handler should acknowledge only after the inbox transaction commits.
Canonical redelivery should not create another row or business transition. A
conflicting payload under an existing event identifier should be quarantined,
not overwritten.

Treat a notification as a wake-up signal unless the current public contract
provides and the application verifies an authentication mechanism. Reconcile
the notification against an authenticated call read before trusting it for a
business decision.

The runnable [webhook result receiver](../apps/python/webhook-result-receiver/)
demonstrates durable receipt, replay detection, and authenticated
reconciliation. Its SQLite table is deliberately a minimal receipt store, not
a complete business-state database or production queue.

## 5. Verify before acting on a result

A terminal status is necessary but not sufficient for a consequential action.
Before a result crosses the business-action boundary, verify that:

- the returned call ID is the call bound to the reserved intent;
- the workflow and schema versions are the expected versions;
- the returned destination matches the exact approved destination inside the
  protected application boundary;
- the status is terminal and allowed by the workflow policy;
- every action-driving structured field passes local schema and bounds checks;
- action-driving fields agree with recipient-side evidence or transcript when
  those sources are available; and
- missing, contradictory, low-confidence, or unexpected values route to
  `needs_human` rather than a success branch.

A phone result reports what happened in a conversation. It must not grant
itself authority to make a payment, revoke access, accept a contract, close an
incident, or perform another irreversible action. Apply a separate policy or
human approval before that transition.

[IncidentBridge](../apps/python/incidentbridge/) demonstrates request, call,
workflow, incident, and destination binding; evidence corroboration; ambiguous
outcome handling; and conservative free-text redaction for one authorized
vendor-support call.

## 6. Assign retry ownership by operation

Do not use one generic retry loop for every failure.

| Failed operation | Safe default |
| --- | --- |
| Local preflight | Correct the intent before any call; do not spend an attempt. |
| Call submission with unknown acceptance | Reconcile the same intent; do not redial automatically. |
| Authenticated status read | Retry the read with bounded backoff; this must not create a call. |
| Webhook reconciliation | Leave the inbox item pending and retry the worker idempotently. |
| Result validation | Route to human review; do not reinterpret or clamp the value. |
| Business-state write | Retry the idempotent business transaction, not the phone call. |

Production owners should define timeout budgets, retry caps, transient and
permanent error classes, dead-letter or review queues, recovery scans, and the
condition that returns a blocked record to normal processing.

## 7. Minimize data and preserve an audit trail

An audit trail should prove which transition occurred without becoming a copy
of every sensitive call artifact. Prefer recording:

- opaque intent, workflow, and call identifiers;
- schema and policy versions or hashes;
- event identifiers and canonical payload digests;
- application state transitions and timestamps;
- the verification checks that passed or failed; and
- the actor or policy that authorized a business transition.

Do not log API keys, bearer tokens, webhook secrets, complete phone numbers, or
credential-like values. Recursively redact nested objects before logging or
returning diagnostic content. Do not retain recordings, transcripts, evidence,
or free text unless the deploying organization has a documented legal basis,
retention period, access policy, and recipient disclosure where required.

The [service-dispatch safety contract](../skills/service-dispatch-call/references/safety.md)
contains the detailed privacy, credential, commitment, and retention rules.

## 8. Choose a queue or workflow engine without changing the boundaries

A durable queue, background worker, or workflow engine can implement this
architecture. The framework does not own the safety contract.

Whichever runtime is selected must preserve:

- a durable intent committed before submission;
- stable identity across retries and process restarts;
- a committed inbox item before acknowledging delivery;
- idempotent worker claims and business transitions;
- explicit reconciliation for unknown outcomes;
- bounded retries with an operator-visible terminal path; and
- retention and cleanup rules that outlive the provider's retry horizon.

Do not infer production readiness from a framework name. Test crash points
between every network side effect and durable write, then prove that restart
does not place a duplicate call or apply a business transition twice.

## Existing reference implementations

| Reference | Demonstrates | Boundary |
| --- | --- | --- |
| [Webhook result receiver](../apps/python/webhook-result-receiver/) | Durable webhook receipt, replay conflict detection, authenticated reconciliation, and retryable reads. | Minimal receipt store; not a business-state machine or full queue/worker deployment. |
| [IncidentBridge](../apps/python/incidentbridge/) | Pre-call reservation, result binding, evidence checks, redaction, and human-owned recovery. | One vendor-support workflow; not a general orchestrator. |
| [Mobilize](../apps/python/mobilize/) | Crash recovery, persisted governance, result binding, and parallel dispatch with a durable ledger. | Domain-specific reference app; not a CALL-E product contract. |
| [FieldClose call workflow](../apps/web/fieldclose/docs/call-workflow.md) and [data contracts](../apps/web/fieldclose/docs/data-contracts.md) | Separate provider and business states, approval binding, reconciliation, PostgreSQL invariants, human disposition, and privacy-minimized audit events. | Domain-specific app; bounded status refresh rather than a general queue/worker, and protected deployment evidence remains pending. |
| [Service dispatch idempotency](../skills/service-dispatch-call/references/idempotency.md) | Stable authorization-derived keys and replay-safe event handling. | Reusable safety pattern, not executable infrastructure. |
| [Ambiguous outcomes](../skills/service-dispatch-call/references/ambiguous-outcomes.md) | Fail-closed handling when a call may already have happened. | Reconciliation policy, not a provider-status guarantee. |
| [Design principles](design-principles.md) | Repository-wide intent, cancellation, portability, and operational boundaries. | High-level principles; this guide supplies the durable production lifecycle. |

## Production review checklist

Before enabling real calls, confirm that the implementation can answer yes to
all of these questions:

- Is business intent durable before the call boundary?
- Is one stable idempotency key bound to one authorized intent?
- Can an unknown submission outcome stop automated redial?
- Can every call, event, and result be bound back to the same intent?
- Does webhook acknowledgment happen only after durable receipt?
- Are worker and business transitions idempotent across crashes?
- Do contradictory or incomplete results fail closed to human review?
- Are logs and audit records recursively redacted and privacy-minimized?
- Are retry caps, recovery scans, retention, and cleanup owned by a named
  operator or service?
- Can all default tests run without credentials, network access, or a real
  phone call?
