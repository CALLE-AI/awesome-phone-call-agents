# FieldClose Call Workflow

## Purpose

This document defines when FieldClose may create a CALL-E phone call, what the agent may discuss, how the conversation is classified, and when the application must stop or escalate to a human.

The call is a bounded closeout-information workflow. It is not a diagnostic, sales, collections, negotiation, or autonomous dispatch call.

## Core rule

One approval authorizes one call attempt to one exact recipient for one exact closeout brief.

Changing the recipient, phone number, work-order reference, requested information, disclosure, authority boundary, or permitted calling window invalidates the approval.

## Roles

### Operator

The authenticated owner-dispatcher or service coordinator who prepares and approves the call.

### Authorized contact

The site representative, facilities contact, property manager, store manager, or other business contact whom the contractor is permitted to contact about the referenced service visit.

### FieldClose

The application that validates the approved case, prevents duplicate calls, invokes CALL-E, normalizes the result, and presents it for human disposition.

### CALL-E agent

The AI phone agent that conducts only the approved conversation and returns provider status and structured results.

## Preflight gates

All gates must pass on the server immediately before live call creation.

| Gate | Required condition | Failure behavior |
| --- | --- | --- |
| Live mode | Live calls are explicitly enabled for this environment | Block the call |
| Operator | An authenticated operator is associated with the approval | Block the call |
| Case state | The case is `approved` and not cancelled | Block the call |
| Approval version | Approval matches the current critical case fields | Invalidate approval |
| Contact basis | Operator affirmed authorization for this contact and purpose | Block the call |
| Phone format | Number is valid E.164 input | Block the call |
| Timezone | Case has an explicit IANA timezone | Block the call |
| Calling window | Current or scheduled local time is permitted | Block or require rescheduling |
| Do-not-call | No refusal or do-not-call block applies | Block the call |
| Idempotency | No call already exists for this approved attempt | Return the existing attempt; do not create another |
| Brief | Required questions and authority limits are complete | Block the call |
| Credentials | Server-side CALL-E authentication is available | Fail safely without exposing credentials |

The client cannot override a failed gate.

## Approved call brief

The operator must review a human-readable brief containing:

- contractor display name;
- work-order reference;
- authorized contact name or role;
- masked destination number;
- explicit IANA timezone and allowed calling window;
- concise, non-sensitive visit context;
- the exact information the agent may request;
- the AI disclosure;
- forbidden topics and commitments;
- the result fields the application expects;
- the cancellation and retry policy.

The provider prompt may include implementation instructions, but it must not expand the operator-approved purpose.

## Minimum information principle

Only provide CALL-E with information required to conduct the approved call. Do not send:

- credentials or internal authentication data;
- payment information;
- unrelated customer history;
- technician private information;
- speculative diagnoses;
- unapproved pricing or scope details;
- private notes that the contact does not need to hear.

## Conversation flow

```text
Call answered
  |
  v
AI identity and contractor disclosure
  |
  v
Confirm intended contact or authorized role
  |
  +--> Wrong person ----------> Apologize, disclose no case details, end
  +--> Refuses / do not call -> Acknowledge, end, block automated retry
  +--> Cannot verify role ----> End and route to human follow-up
  |
  v
Reference the approved service visit without exposing unnecessary details
  |
  v
Ask approved closeout questions
  |
  +--> Technical advice requested --> Decline and route to human
  +--> Price/scope/payment topic ----> Decline and route to human
  +--> Emergency or safety concern --> Stop; direct to local emergency services (911 in the US); end; route to human
  +--> Ambiguous answer ------------> One bounded clarification, then preserve uncertainty
  |
  v
Read back material facts when appropriate
  |
  v
Explain that the contractor will review the information
  |
  v
End without promising closeout, approval, price, or arrival time
```

## Opening and disclosure

The opening must:

1. identify the caller as an AI assistant;
2. name the contractor represented by the assistant;
3. state that the purpose is a brief follow-up about a recent service visit;
4. confirm that the recipient is the intended contact or authorized site role before sharing case details;
5. honor refusal immediately.

Example intent, not final provider prompt:

> Hello, I am an AI assistant calling on behalf of Example HVAC about a recent service visit. Am I speaking with the authorized site contact for this location?

The demo must use a fictional contractor name unless the real contractor has authorized its use.

## Allowed questions

The operator selects a subset of the following approved question families.

### Observed operating status

Ask whether, from the contact's perspective, the serviced equipment or affected area appears to be operating as expected after the visit.

The agent records a report; it does not diagnose or certify the equipment.

### Unresolved issue

Ask whether the contact is aware of an unresolved issue related to the service visit. Capture a short factual description in the contact's own terms.

The agent must not suggest a cause or remedy.

### Return-visit request

Ask whether the contact wants the contractor to review a possible return visit.

The agent may collect preferred windows but must state that the contractor will confirm availability separately.

### Approved administrative detail

Ask only for a preconfigured, non-sensitive administrative field required for closeout, such as the correct billing-contact role or whether a purchase-order reference is still pending.

The agent must not collect payment credentials, bank details, authentication secrets, government identifiers, or financial authorization.

## Prohibited actions

The agent must not:

- diagnose a technical fault;
- recommend a repair, part, setting, or safety procedure;
- state that equipment is safe or certified;
- quote or negotiate price, credit, warranty, or scope;
- approve work or create a binding appointment;
- promise an arrival, completion, callback, or resolution time;
- authorize invoicing, payment, refund, or account changes;
- request secrets or payment credentials;
- disclose case information to an unverified person;
- continue after a refusal or do-not-call request;
- improvise new business objectives;
- provide medical, legal, or financial advice;
- handle an emergency as the only response path.

## Bounded clarification

For an unclear answer, the agent may ask at most one clarification that remains within the approved question family.

If the answer remains unclear, record it as `unknown` or `ambiguous` and route the case to human follow-up. Do not pressure the contact or convert uncertainty into a positive confirmation.

## Closing

The closing must:

- summarize only the material facts the contact provided;
- allow the contact to correct the summary;
- state that the contractor will review the information;
- avoid promising that the work order is closed or that a return visit is confirmed;
- provide an appropriate human contact path when configured;
- end promptly after the bounded objective is complete.

## Voicemail and no answer

The MVP default is not to leave a voicemail.

If voicemail is later enabled, the operator must approve a separate neutral voicemail template that contains no sensitive service details. A voicemail never counts as a completed closeout conversation.

No answer, busy, voicemail, carrier failure, and provider timeout are recorded as distinct attempt outcomes.

## Retry policy

The MVP performs no automatic live retries.

Any new attempt requires:

1. a human review of the prior attempt;
2. confirmation that no refusal or do-not-call block applies;
3. a new permitted calling time;
4. a new approval and idempotency key.

This policy may be revisited only after real-user validation and explicit documentation.

## Cancellation boundary

- Before provider call creation: the operator can cancel the case or approved attempt.
- After the provider has accepted call creation: FieldClose must present the provider's actual cancellation capability and must not claim cancellation if it cannot verify it.
- After a call has connected: the agent must honor the recipient's request to end the conversation immediately.
- After a result is received: cancellation becomes human disposition or data-handling action, not retroactive call cancellation.

## Provider and business states

Provider state and FieldClose business state must remain separate.

Examples:

- Provider `completed` plus clear resolved report -> `ready_for_closeout_review`
- Provider `completed` plus unresolved issue -> `return_visit_review`
- Provider `completed` plus ambiguous answers -> `human_follow_up`
- Provider `no_answer` -> `unreachable`
- Provider unknown after a timeout -> `needs_attention`, not a retry
- Provider creation error with no accepted call identifier -> `failed`
- Provider creation response is ambiguous -> `needs_attention` and reconciliation before any new attempt

## Idempotency and duplicate prevention

The idempotency key must be derived from a stable approved-attempt identifier created by the server. It must not be generated anew on browser refresh or button retry.

When the provider response is ambiguous, FieldClose must reconcile the original attempt using stored request metadata or provider identifiers. It must not assume failure and create another call.

## Structured result rules

The CALL-E result is normalized into the contract in [Data Contracts](data-contracts.md). The normalizer must:

- preserve provider status separately;
- distinguish `yes`, `no`, `unknown`, `not_asked`, and `refused`;
- attach confidence or evidence references without inventing facts;
- record out-of-scope and escalation reasons;
- avoid treating call completion as business confirmation;
- route schema failures to human review.

## Required scenario coverage

The implementation and demo fixtures must cover:

1. Correct contact, equipment reported operating, no issue reported.
2. Correct contact, unresolved issue reported, return visit requested.
3. Correct contact, answer remains ambiguous after clarification.
4. Wrong person answers.
5. Recipient refuses or requests no further automated calls.
6. No answer or voicemail.
7. Recipient asks for technical advice.
8. Recipient asks for a price, authorization, payment, or guaranteed time.
9. Provider returns an unknown or malformed result.
10. Duplicate browser action attempts to create the same approved call twice.

## Human disposition

Only an authenticated workspace owner or operator may record the FieldClose
disposition. An auditor remains read-only. The application may recommend a route
and display supporting evidence, but the final decision must be an explicit,
persisted human action.

The permitted dispositions are:

- accept a `ready_for_closeout_review` recommendation;
- record that return-visit review was handed to a human process;
- record that an exception was handed to a human follow-up process;
- record that no further automated action will be taken.

Recording a disposition may resolve the current task and close the FieldClose
case. It does not close an external work order, create or confirm a return visit,
change commercial terms, take financial action, or prove that the human handoff
was completed. Those actions remain outside the application boundary.

The decision must be version-bound, idempotent for an exact repeat, and visible
in the audit history. Stale or conflicting disposition input changes nothing.
