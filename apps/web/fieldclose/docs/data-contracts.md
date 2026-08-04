# FieldClose Data Contracts

## Purpose

This document defines the FieldClose domain and persistence contracts. The MVP expresses them as TypeScript types, PostgreSQL tables, Drizzle ORM declarations, and generated SQL migrations. Runtime request and provider validation will use Zod and a restricted CALL-E JSON Schema.

## Contract principles

1. Provider status and business interpretation are separate.
2. Unknown, refused, not asked, and unavailable are distinct values.
3. Approval is versioned and bound to an exact call brief.
4. A call attempt has one stable server-generated idempotency key.
5. Phone numbers are stored only where required and masked in presentation data.
6. Raw provider data is untrusted input and must be validated before use.
7. A completed call is not the same as a closed HVAC work order.
8. Audit events are append-only from the application perspective.

## Common conventions

| Value | Convention |
| --- | --- |
| Internal identifiers | UUID or similarly collision-resistant opaque identifiers |
| Timestamps | ISO 8601 UTC strings, such as `2026-07-28T08:30:00Z` |
| Timezones | Explicit IANA names, such as `America/Chicago` |
| Phone input | E.164, such as a fictional reserved example number |
| Phone display | Masked, such as `+1 ******0142` |
| Provider identifiers | Opaque strings; never parse business meaning from them |
| Enum values | Lowercase snake case |
| Free text | Length-limited and treated as untrusted input |
| Money | Not part of the MVP call contract |

## Shared answer value

Many closeout fields use the following answer state:

```json
{
  "value": "yes | no | unknown | not_asked | refused",
  "confidence": "high | medium | low | unavailable",
  "evidenceRefs": ["provider-result:field-name"],
  "note": "Optional short factual note"
}
```

The normalizer must not convert `unknown`, `refused`, or absent data into `no`.

## Authentication and workspace scope

Better Auth owns the `user`, `session`, `account`, and `verification` contracts. The user record includes optional normalized and display usernames; credential password hashes live in `account`; short-lived hashed email OTP values live in `verification`. FieldClose application records reference the stable Better Auth user ID only where ownership or membership is required. Passwords, OTPs, OAuth tokens, and session tokens never appear in application API responses.

`Workspace` is the tenant and safety boundary for all closeout data.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | yes | Internal UUID |
| `slug` | string | yes | Unique opaque-friendly workspace slug |
| `displayName` | string | yes | Length-limited presentation name |
| `kind` | enum | yes | `demo` or `protected` |
| `provider` | enum | yes | `fake` or `call_e` |
| `liveCallsAllowed` | boolean | yes | Workspace-level gate; always false for demo |
| `ownerUserId` | string | yes | Better Auth user ID |
| `createdAt` | timestamp | yes | UTC |
| `updatedAt` | timestamp | yes | UTC |

`WorkspaceMembership` joins one Better Auth user to one workspace with the role `owner`, `operator`, or `auditor`. The `(workspaceId, userId)` pair is unique.

`WorkspaceAdministrativeEvent` is an append-only record of protected-workspace provisioning and live-gate changes. It stores the workspace ID, authenticated actor user ID, bounded event type, allow-listed non-sensitive metadata, and UTC occurrence time. It does not store the actor email, credentials, contact data, or request body.

## CloseoutCase

Represents one bounded closeout workflow.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | yes | Internal opaque identifier |
| `workspaceId` | string | yes | Authenticated workspace boundary |
| `version` | integer | yes | Increments when approval-critical data changes |
| `status` | enum | yes | See case status enum |
| `workOrderRef` | string | yes | External reference; avoid embedding sensitive data |
| `contractorDisplayName` | string | yes | Name the agent is allowed to disclose |
| `siteLabel` | string | yes | Human-readable label; minimize address data in demos |
| `timezone` | string | yes | Explicit IANA timezone |
| `contactId` | string | yes | References `Contact` |
| `requestedFields` | string[] | yes | Approved question families |
| `visitContext` | object | yes | Minimal facts permitted in the call brief |
| `currentAttemptId` | string or null | yes | Current or most recent attempt |
| `createdBy` | string | yes | Operator identifier |
| `createdAt` | timestamp | yes | UTC |
| `updatedAt` | timestamp | yes | UTC |
| `cancelledAt` | timestamp or null | yes | UTC |

### Case status enum

```text
draft
approved
calling
completed
needs_attention
failed
closed
cancelled
```

### Visit context

The MVP visit context may contain:

```json
{
  "serviceDate": "2026-07-27",
  "equipmentLabel": "Rooftop unit RTU-2",
  "technicianCompletionNote": "Filter replaced and unit restarted",
  "allowedReferenceText": "A technician visited yesterday to service RTU-2"
}
```

`technicianCompletionNote` is internal context. Only `allowedReferenceText` may be spoken unless the operator explicitly approves other content.

## Contact

Represents the intended business contact.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | yes | Internal opaque identifier |
| `workspaceId` | string | yes | Authenticated workspace boundary |
| `displayName` | string or null | yes | May use an authorized role instead of a personal name |
| `role` | string | yes | For example, `site_manager` or `facilities_contact` |
| `phoneE164Ciphertext` | string | yes | AES-256-GCM ciphertext; never returned to normal browser views |
| `phoneEncryptionIv` | string | yes | Per-value encryption IV |
| `phoneEncryptionTag` | string | yes | Authentication tag for encrypted phone data |
| `phoneKeyVersion` | string | yes | Supports controlled key rotation |
| `phoneLookupHash` | string | yes | HMAC lookup token; never a plain unsalted hash |
| `phoneMasked` | string | yes | Safe presentation form |
| `authorizationBasis` | enum | yes | Operator-attested business basis |
| `authorizationNote` | string | yes | Short, factual operator note |
| `doNotCallAt` | timestamp or null | yes | Blocks automated attempts when set |
| `createdAt` | timestamp | yes | UTC |
| `updatedAt` | timestamp | yes | UTC |

### Authorization basis enum

```text
existing_service_contact
contact_requested_follow_up
contractor_provided_authorized_contact
demo_fixture
```

The MVP must not provide an `unknown` authorization option for live calls.

## CallApproval

Captures the human decision that authorizes exactly one attempt.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | yes | Approval identifier |
| `caseId` | string | yes | Approved case |
| `caseVersion` | integer | yes | Must equal current case version at call creation |
| `approvedAttemptId` | string | yes | Exact attempt authorized |
| `approvedBy` | string | yes | Authenticated operator identifier |
| `approvedAt` | timestamp | yes | UTC |
| `expiresAt` | timestamp or null | yes | Optional policy expiry |
| `briefHash` | string | yes | Digest of approval-critical canonical data |
| `liveCallApproved` | boolean | yes | `false` for dry-run preview |
| `callingWindow` | object | yes | Permitted local window and timezone |
| `operatorAttestations` | string[] | yes | Authorization and review confirmations |

Approval becomes invalid when the current case version or canonical brief hash changes.

## CallBrief

The reviewed business contract passed to the provider adapter.

```json
{
  "caseId": "case_01",
  "attemptId": "attempt_01",
  "contractorDisplayName": "Example HVAC",
  "recipient": {
    "nameOrRole": "Site manager",
    "phoneE164": "+12025550142",
    "timezone": "America/Chicago"
  },
  "disclosure": "I am an AI assistant calling on behalf of Example HVAC.",
  "objective": "Collect approved closeout information for work order WO-DEMO-1042.",
  "allowedReferenceText": "A technician visited yesterday to service RTU-2.",
  "questions": [
    "observed_operating_status",
    "unresolved_issue",
    "return_visit_request",
    "preferred_return_window"
  ],
  "prohibitedActions": [
    "diagnose_equipment",
    "quote_or_negotiate",
    "approve_work",
    "promise_arrival_time",
    "authorize_payment"
  ],
  "voicemailPolicy": "do_not_leave",
  "maxBoundedClarificationsPerQuestion": 1
}
```

The example number is in the fictional North American `555-01xx` range and must never be replaced with a private number in committed fixtures.

## CallAttempt

Represents one approved interaction with the provider.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | yes | Created before approval |
| `caseId` | string | yes | Parent case |
| `approvalId` | string | yes for live | Exact approval |
| `mode` | enum | yes | `dry_run`, `fake`, or `live` |
| `idempotencyKey` | string | yes | Stable, server-generated |
| `requestFingerprint` | string | yes | Digest of canonical provider-bound input |
| `provider` | enum | yes | `fake` or `call_e` |
| `providerCallId` | string or null | yes | Opaque provider identifier |
| `providerTaskStatus` | enum | yes | Raw CALL-E task status, kept separate from business interpretation |
| `attemptOutcome` | enum | yes | Business outcome supported by validated attempt or result evidence |
| `creationDisposition` | enum | yes | Outcome of provider call creation |
| `requestedAt` | timestamp or null | yes | UTC |
| `acceptedAt` | timestamp or null | yes | UTC |
| `connectedAt` | timestamp or null | yes | UTC |
| `endedAt` | timestamp or null | yes | UTC |
| `lastCheckedAt` | timestamp or null | yes | UTC |
| `errorCode` | string or null | yes | Sanitized application code |

### Provider task status enum

```text
not_created
queued
in_progress
completed
failed
canceled
unknown
```

`not_created` is a local pre-provider state and `unknown` is the safe fallback. The remaining values map directly to documented provider task states. FieldClose does not infer ringing, connection, or business outcomes from this enum.

### Attempt outcome enum

```text
not_determined
answered
partial_answer
no_answer
busy
voicemail
wrong_person
refused
unknown
```

An attempt outcome is populated only when supported by validated provider evidence. Absence of evidence remains `not_determined` or `unknown`.

### Creation disposition enum

```text
not_requested
created
duplicate_returned
blocked
failed_before_acceptance
ambiguous_requires_reconciliation
```

## CallResult

Contains the normalized business result while preserving provider facts.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | yes | Result identifier |
| `caseId` | string | yes | Parent case |
| `attemptId` | string | yes | Source attempt |
| `providerCallId` | string | yes when available | Opaque provider reference |
| `providerTaskStatus` | enum | yes | Raw provider task status at normalization |
| `contactVerification` | enum | yes | See below |
| `observedOperatingStatus` | enum | yes | Contact report, not diagnosis |
| `unresolvedIssue` | answer object | yes | Shared answer value plus optional note |
| `returnVisitRequested` | answer object | yes | Does not create an appointment |
| `preferredWindows` | object[] | yes | Empty when not asked or unavailable |
| `administrativeResults` | object | yes | Only approved non-sensitive fields |
| `outOfScopeTopics` | string[] | yes | Coded topics, not sensitive prose |
| `escalationReasons` | string[] | yes | Machine-readable reasons |
| `summary` | string | yes | Short factual summary |
| `evidenceRefs` | string[] | yes | References into permitted provider result data |
| `route` | enum | yes | Business route recommendation |
| `normalizerVersion` | string | yes | Supports reproducibility |
| `normalizedAt` | timestamp | yes | UTC |

### Contact verification enum

```text
intended_contact
authorized_role
wrong_person
unverified
refused
not_connected
```

### Observed operating status enum

```text
operating_as_expected
not_operating_as_expected
mixed_or_partial
unknown
not_asked
refused
```

### Route enum

```text
ready_for_closeout_review
return_visit_review
human_follow_up
unreachable
failed
```

### Preferred window

```json
{
  "startLocal": "2026-07-30T09:00:00",
  "endLocal": "2026-07-30T12:00:00",
  "timezone": "America/Chicago",
  "status": "reported_preference_not_confirmed"
}
```

No preferred window is a confirmed appointment.

## FollowUpTask

Represents a human-visible next action.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | yes | Task identifier |
| `caseId` | string | yes | Parent case |
| `type` | enum | yes | `closeout_review`, `return_visit_review`, `contact_review`, `technical_review`, `provider_reconciliation`, or `privacy_request` |
| `reasonCodes` | string[] | yes | Machine-readable reasons |
| `status` | enum | yes | `open`, `in_progress`, `resolved`, or `cancelled` |
| `assignedTo` | string or null | yes | Optional operator identifier |
| `createdAt` | timestamp | yes | UTC |
| `resolvedAt` | timestamp or null | yes | UTC |
| `resolutionNote` | string or null | yes | Human-authored and length-limited |

## HumanDisposition

Represents the final bounded decision recorded by an authorized FieldClose
operator. It closes the application workflow; it is not evidence that an
external work order, appointment, invoice, or return visit was completed.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | yes | Disposition identifier |
| `caseId` | string | yes | Parent case; unique for the MVP |
| `taskId` | string | yes | The current human task resolved by this decision |
| `outcome` | enum | yes | One bounded value from the table below |
| `resolutionNote` | string or null | yes | Operator-authored, trimmed, and limited to 1,000 characters |
| `recordedBy` | string | yes | Authenticated owner or operator identifier |
| `recordedAt` | timestamp | yes | UTC |

### Human disposition outcomes

| Outcome | Permitted meaning | Prohibited interpretation |
| --- | --- | --- |
| `closeout_accepted` | The operator reviewed a `ready_for_closeout_review` result and accepts the FieldClose closeout recommendation | The external work order was closed or invoiced automatically |
| `return_visit_handoff` | The operator recorded that the reported issue or request was handed to a human scheduling or service-review process | A return visit or arrival time was confirmed |
| `manual_follow_up_handoff` | The operator recorded human ownership of an ambiguous, sensitive, unreachable, failed, or other exception | FieldClose performed the follow-up action |
| `no_further_automated_action` | The operator ended this FieldClose workflow without another automated attempt | A refusal or do-not-call block was removed |

`return_visit_handoff` and `manual_follow_up_handoff` require a non-blank
resolution note. `closeout_accepted` is permitted only for the
`ready_for_closeout_review` route. The application derives the actor from the
session and never accepts `recordedBy` from the browser.

## AuditEvent

Records a material event without storing secrets or unnecessary conversation content.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | yes | Event identifier |
| `caseId` | string | yes | Parent case |
| `attemptId` | string or null | yes | Related attempt when applicable |
| `actorType` | enum | yes | `operator`, `system`, or `provider` |
| `actorId` | string or null | yes | Internal identifier; null for external provider |
| `eventType` | string | yes | Versioned machine-readable event |
| `occurredAt` | timestamp | yes | UTC |
| `metadata` | object | yes | Redacted, allow-listed metadata only |

Recommended event types include:

```text
case.created
case.updated
case.cancelled
approval.granted
approval.invalidated
attempt.blocked
attempt.creation_requested
attempt.provider_accepted
attempt.status_changed
attempt.reconciliation_required
result.received
result.normalized
task.created
case.human_disposition_recorded
contact.do_not_call_recorded
```

## State transition rules

- Only `draft` can become `approved`.
- Only a valid `approved` case can enter `calling`.
- Provider acceptance creates or preserves the single current attempt.
- `calling` may become `completed`, `needs_attention`, or `failed`.
- `completed` describes result normalization, not work-order closeout.
- Only a human disposition may move an eligible case to `closed`.
- A human disposition resolves or cancels the referenced open task in the same
  transaction that moves the FieldClose case to `closed` and increments its
  version.
- Repeating the exact recorded disposition returns the existing record;
  conflicting or stale disposition input changes nothing.
- `cancelled` and `closed` are terminal for automated call creation.
- A refusal or do-not-call result blocks new automated attempts regardless of case state.

## PostgreSQL persistence invariants

The implemented migrations currently create sixteen durable tables: the four
Better Auth tables, `workspace`, `workspace_membership`,
`workspace_administrative_event`, and the nine closeout workflow tables
(`contact`, `closeout_case`, `call_attempt`, `call_approval`, `call_result`,
`follow_up_task`, `human_disposition`, `audit_event`, and `system_setting`).
Migration `0004` intentionally drops the former provider callback event table
and its processing-status enum, including historical callback event records.
Migration `0005` adds the bounded human-disposition record and its case/task
integrity constraints.

Database constraints enforce the invariants that should remain true even under retries or concurrent requests:

- attempt idempotency keys, non-null provider call IDs, and provider event IDs are globally unique;
- work-order reference uniqueness is scoped to a workspace;
- demo workspaces are permanently fake-only and live-disabled;
- cases cannot reference contacts from another workspace;
- a case or task can have at most one human disposition, and the disposition's
  task must belong to the same case;
- one attempt can have at most one approval and one normalized result;
- approval, result, and attempt-linked audit records must belong to the same case as their source attempt;
- a case's current attempt must belong to that case;
- a live attempt must reference the exact approval created for that case and attempt;
- requested-field, attestation, and reason-code arrays cannot be empty;
- case and approval versions are positive;
- the initial `live_calls_paused` database kill switch is `true`;
- audit events reject direct updates and deletes unless a controlled privacy process explicitly enables mutation for its database session.
- workspace administration events reject every direct update or delete.

The schema intentionally stores normalized evidence rather than full recordings or transcripts.

## Validation boundaries

### Browser to application server

- Treat all fields as untrusted.
- Ignore client-supplied approval, authorization, provider status, and idempotency assertions.
- Recalculate permission, approval validity, calling window, and duplicate state on the server.

### Application server to CALL-E

- Send only the approved brief.
- Keep provider credentials server-side.
- Record a stable attempt before the external request.
- Use the provider's supported idempotency mechanism when available.

### CALL-E to application server

- Retrieve status only through the authenticated server-side provider client.
- Validate payload shape and size.
- Treat transcript and summary content as untrusted text.
- Make repeated status reads and terminal-result processing idempotent.
- Reconcile unknown outcomes before permitting another call.

## Redaction and retention

- Do not include `phoneE164` in normal API responses when `phoneMasked` is sufficient.
- Do not log credentials, complete private phone numbers, recordings, or full transcripts.
- Store only evidence required to explain the result and audit the workflow.
- Define retention and deletion periods before a public live demo.
- A deletion process must account for cases, attempts, normalized results, provider-held artifacts, and backups.

## Examples

- [Sample work order](../examples/sample-work-order.json)
- [Sample normalized call result](../examples/sample-call-result.json)

The examples are fixtures, not evidence of a completed live call.

## Selected implementation decisions

- PostgreSQL 17 is the relational source of truth and Drizzle owns schema declarations and migrations.
- Zod validates application boundaries; a restricted JSON Schema validates CALL-E structured results.
- Phone numbers use application-layer AES-256-GCM encryption plus a separate HMAC lookup key.
- Better Auth with credentials, email OTP, optional GitHub OAuth, and secure cookies provides authenticated server-side sessions.
- Authenticated bounded status lookup is the only result path, with five-second server-side throttling, a 600-second automatic limit, and explicit reconciliation.
- Retention and privacy deletion run through controlled application workflows; provider-held artifacts and backups remain part of the deletion plan.
