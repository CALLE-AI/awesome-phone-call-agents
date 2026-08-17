# FieldClose Product Specification

## Document status

- Status: Scope frozen for hackathon submission
- Audience: Product, design, engineering, testing, and hackathon reviewers
- Product phase: Submission hardening and evidence collection
- Last updated: 2026-08-03

## Product summary

FieldClose is a web application for small commercial HVAC contractors. It helps an owner-dispatcher or service coordinator follow up on completed field work through a human-approved CALL-E phone call, then converts the conversation into a structured closeout recommendation or a human exception.

FieldClose is not a general voice-agent platform. The initial product solves one bounded workflow: collecting the information an HVAC office still needs after a technician has completed a commercial service visit.

## Competition objective

FieldClose is optimized to compete for **Most Practical Use Case**. The product
claim is deliberately narrow:

> FieldClose turns one human-approved HVAC after-service confirmation call into
> a trustworthy, structured, actionable next step for a human operator.

The submission should prove the complete chain from a reviewed work order to a
human decision. It should not compete on the number of screens, agent autonomy,
or the breadth of telephony features.

The product's innovation is expressed through six connected mechanisms:

| Mechanism | Required product behavior | Evidence for reviewers |
| --- | --- | --- |
| Approval-bound call | Approval is bound to the exact case version, recipient, brief, calling window, and one attempt | Reviewed brief, attestations, approval digest, and audit event |
| Uncertainty-preserving result | Unknown, refused, unavailable, and ambiguous answers remain distinct from confirmed facts | Structured result beside the human follow-up route |
| One attempt / no duplicate | A stable server-created idempotency key and persisted attempt claim prevent refresh or repeat actions from creating another call | Repeated execution returns the original attempt and one audit trail |
| Human decision boundary | FieldClose recommends a route but never diagnoses, confirms a visit, or closes the work order autonomously | A visible human task and disposition control after every result |
| Ambiguous creation reconciliation | An uncertain provider creation response freezes resubmission until the original attempt is reconciled | `needs_attention`, one reconciliation task, and no automatic redial |
| Safe fake-only public experience | The judge-accessible environment has deterministic scenarios and no path or credential capable of placing a call | Fake-only labels, deployment gate, and public smoke-test evidence |

These mechanisms are useful only when presented as one practical workflow. They
are not separate platform features.

## Product hypothesis

If a small commercial HVAC contractor can review and approve a narrowly scoped closeout call, then an AI phone agent can reduce repetitive phone chasing and surface unresolved work earlier without transferring business judgment to the agent.

This hypothesis must be validated with real users and consented test calls. It is not yet an established fact.

## Target customer

### Company profile

- Small commercial HVAC service contractor
- A limited office staff in which one person may handle dispatch, customer communication, and closeout
- Uses phone calls, email, spreadsheets, or a lightweight field-service system
- Serves facilities contacts, property managers, store managers, or other authorized site contacts

### Primary persona

**Owner-dispatcher or service coordinator**

- Reviews technician notes after a visit
- Chases missing confirmation or follow-up information
- Decides whether a case is ready to close, needs a return visit, or requires escalation
- Needs a clear audit trail without learning a new telephony system

### Secondary persona

**Service manager**

- Reviews exception cases
- Resolves technical, commercial, or customer-sensitive questions
- Monitors closeout quality and repeat-visit signals

## Jobs to be done

When a technician completes a commercial HVAC visit but the work order still lacks customer confirmation, the dispatcher wants to contact the authorized site representative, collect a small set of approved facts, and route the case to the right next action so the job does not remain in administrative limbo.

## Problem statement

A technician marking a work order complete does not guarantee that the office can safely close it. The office may still need to know:

- whether the equipment appears to be operating as expected from the contact's perspective;
- whether the contact reports an unresolved issue;
- whether a return visit is requested;
- which return window is acceptable, without promising that the contractor will attend then;
- whether a configured non-payment administrative detail is still missing;
- whether a human needs to follow up.

These questions are often handled through repeated manual calls. Unanswered calls, partial responses, and informal notes can delay closeout and hide exceptions.

## Goals

1. Make every outbound call inspectable and explicitly approved.
2. Give the phone agent a narrow objective and explicit authority boundary.
3. Produce a structured, uncertainty-preserving result from each completed call.
4. Route every case to a concrete human-visible next action.
5. Prevent duplicate or out-of-window calls.
6. Demonstrate a credible **Most Practical Use Case** submission for CALL-E.

## Non-goals

The MVP will not:

- diagnose HVAC equipment or recommend repairs;
- quote, negotiate, or approve prices or scope;
- authorize additional work, invoices, refunds, or payments;
- collect payment-card, bank-account, or authentication information;
- promise technician arrival or service completion times;
- close a work order or trigger invoicing without human review;
- run lead generation, sales, or marketing campaigns;
- place unapproved batch calls;
- replace a field-service management platform;
- handle emergency dispatch.

## Submission scope freeze

The product scope and UI information architecture are frozen through the
hackathon submission. The team will not add another workflow, provider,
top-level navigation destination, dashboard category, question family, or
autonomous decision path before submission.

Permitted changes are limited to:

- correcting defects or safety gaps in the existing workflow;
- making the existing three-minute path faster and clearer with fictional
  preset data, without adding a new workflow stage;
- deployment, authentication, accessibility, responsive, and reliability
  hardening;
- evidence capture, documentation, upstream packaging, and submission assets.

A proposed pre-submission change must either remove a P0/P1 blocker, strengthen
one of the six mechanisms above, or make the existing golden path more reliable.
Otherwise it is deferred.

## Core user journey

1. The dispatcher creates a closeout case from a completed work order.
2. The dispatcher enters or confirms the authorized contact and explicit IANA timezone.
3. FieldClose identifies the closeout fields requested for this case.
4. The dispatcher previews the exact call brief, disclosure, and prohibited actions.
5. The dispatcher approves one call attempt.
6. FieldClose validates the case and creates one CALL-E call at runtime.
7. FieldClose receives or retrieves the provider result.
8. The result is normalized into the FieldClose result contract.
9. The case is routed to closeout review, return-visit review, human follow-up, or failed/unreachable handling.
10. The dispatcher records a bounded final disposition, resolves the current
    human task, and closes the FieldClose case or leaves an explicit human-owned
    handoff.

For the submission golden path, the case uses a preset fictional work order and
only three approved question families: observed operating status, unresolved
issue, and return-visit request. No new closeout field is required for the
competition demonstration.

## MVP screens

### 1. Closeout cases

- Shows cases grouped by current state.
- Highlights cases requiring human attention.
- Displays no unmasked phone number by default.

### 2. New closeout case

- Captures work-order reference and limited visit context.
- Captures the authorized contact, E.164 phone number, and IANA timezone.
- Lets the operator select the information the call may request.

### 3. Call review

- Displays the intended recipient and masked number.
- Displays the exact purpose, questions, disclosure, and authority limits.
- Shows the allowed calling window and duplicate-call status.
- Requires explicit approval for exactly one call attempt.

### 4. Case detail

- Shows the case state, call attempts, provider status, normalized result, and audit events.
- Separates provider facts from FieldClose interpretation.
- Preserves uncertainty and raw-result references without exposing unnecessary transcript content.
- Lets an owner or operator record the bounded human disposition after reviewing
  the result and current task.

### 5. Exceptions

- Lists ambiguous, refused, wrong-person, out-of-scope, failed, or technically sensitive outcomes.
- Gives the human operator a clear reason and recommended follow-up action.
- Lets an owner or operator record the permitted handoff or resolution without
  performing scheduling, technical, or commercial work inside FieldClose.

## Functional requirements

### Case management

- **FC-001:** An operator can create a case with a unique internal identifier.
- **FC-002:** A case must reference a completed work order or demo fixture.
- **FC-003:** A case records only the minimum context required for its approved closeout questions.
- **FC-004:** A case can be cancelled before call creation.

### Contact and authorization

- **FC-010:** A case requires an authorized contact name or role, E.164 number, and explicit IANA timezone. The initial live CALL-E scope accepts only US `+1` E.164 recipients because the provider request is fixed to `US` and `en-US`; fake cases may continue to use any explicit fictional E.164 fixture.
- **FC-011:** The operator must affirm the business basis for contacting the recipient.
- **FC-012:** The application must not infer contact authorization, country code, or timezone.
- **FC-013:** A do-not-call or refusal result blocks further automated attempts for that contact and purpose.

### Review and approval

- **FC-020:** The application renders an exact, human-readable call brief before approval.
- **FC-021:** Approval is tied to the current case version, contact, objective, and one attempt.
- **FC-022:** Editing an approved critical field invalidates the approval.
- **FC-023:** Live-call creation is impossible when live calls are disabled.

### Call execution

- **FC-030:** The server invokes CALL-E only after all preflight checks pass.
- **FC-031:** Call creation uses a stable idempotency key.
- **FC-032:** The UI cannot directly supply provider credentials or bypass server-side approval checks.
- **FC-033:** Ambiguous provider responses do not trigger an automatic retry.

### Result handling

- **FC-040:** FieldClose stores provider status separately from the normalized business result.
- **FC-041:** Normalized results distinguish confirmed, reported, unknown, refused, and unavailable values.
- **FC-042:** Unsupported, sensitive, or ambiguous statements route to human review.
- **FC-043:** A completed call never directly authorizes technical or financial action.

### Auditability

- **FC-050:** The system records case creation, material edits, approval, call creation, result receipt, cancellation, and human disposition.
- **FC-051:** Audit views mask phone numbers and exclude secrets.
- **FC-052:** The system can explain why a call was blocked or a case was escalated.

### Human disposition

- **FC-060:** Only an authenticated workspace owner or operator may record a
  human disposition; an auditor remains read-only.
- **FC-061:** A disposition is bound to the current case version, normalized
  result, and open follow-up task so stale browser state cannot overwrite a
  newer decision.
- **FC-062:** The operator selects one bounded outcome appropriate to the
  current route: `closeout_accepted`, `return_visit_handoff`,
  `manual_follow_up_handoff`, or `no_further_automated_action`.
- **FC-063:** Recording a disposition resolves or cancels the applicable human
  task and may move the FieldClose case to `closed`; it never closes an external
  work order, confirms an appointment, authorizes invoicing, or performs the
  handoff itself.
- **FC-064:** Repeating the same disposition request is idempotent. A conflicting
  or stale request is rejected without changing the stored decision.
- **FC-065:** The application stores the operator, timestamp, bounded outcome,
  and length-limited resolution note, then appends
  `case.human_disposition_recorded` to the redacted audit history.

## Case lifecycle

```text
draft
  | approve
  v
approved
  | create call
  v
calling ---------------------> failed
  | result received               |
  v                               v
completed                  needs_attention
  | human disposition             |
  +-----------> closed <-----------+

draft or approved -----> cancelled
```

`completed` means that FieldClose received and normalized a call result. It does
not mean that the HVAC work order has been automatically closed. `closed` means
that an authorized operator recorded the final FieldClose disposition; it still
does not prove that an external work order, appointment, invoice, or return visit
was completed.

## Result routes

- **ready_for_closeout_review:** The contact was reached and no unresolved issue was reported, subject to human review.
- **return_visit_review:** The contact reported an unresolved issue or requested another visit.
- **human_follow_up:** The result was ambiguous, sensitive, out of scope, refused, or incomplete.
- **unreachable:** No authorized conversation was completed.
- **failed:** A technical or provider error prevented a reliable result.

## Success measures

### Primary

$$
\text{Actionable Closeout Rate}
=
\frac{\text{Approved call attempts that produce a usable next step}}
{\text{Total approved call attempts}}
$$

### Supporting measures

- Median time from case creation to human disposition
- Dispatcher minutes spent per case
- Human-escalation rate
- Unreachable rate
- Duplicate-call prevention rate
- Incorrect automatic-ready classification count
- Percentage of attempts with complete audit evidence

Targets will be set only after baseline testing. The MVP must not invent performance claims.

## MVP acceptance criteria

The hackathon MVP is acceptable when:

1. A user can create and review a closeout case in the web application.
2. Default local operation demonstrates the full workflow without a real call.
3. A separately enabled, authorized path creates a real CALL-E call at runtime.
4. At least one consented test call produces an inspectable provider result.
5. That result causes a visible, explainable FieldClose state transition.
6. Duplicate approval or refresh actions do not create duplicate calls.
7. A refused, ambiguous, or out-of-scope response routes to human review.
8. Setup, credentials, side effects, cancellation boundaries, and tests are documented.
9. An owner or operator can record a route-appropriate human disposition,
   resolve the open follow-up task, and produce the visible final case state.
10. Repeated or stale disposition requests cannot duplicate or overwrite the
    final decision, and the disposition is present in the audit history.

The product criteria above are necessary but not sufficient for submission. The
release also requires a judge-accessible fake-only deployment, an isolated
protected staging environment, one authorized CALL-E result with redacted
evidence, a stable three-minute demonstration, and a validated upstream
contribution. These delivery gates are tracked in
[Hackathon Submission Plan](hackathon-submission-plan.md).

## Assumptions to validate

- Small commercial HVAC teams experience meaningful closeout delay caused by phone follow-up.
- Site and facilities contacts are reachable by phone more reliably than through a contractor-specific portal.
- A bounded closeout conversation can collect enough information to create a useful next action.
- Contractors will accept a human-approved AI call when identity and authority are clear.
- CALL-E returns enough status and structured-result information for reliable normalization.

## Deferred product questions

These questions are intentionally deferred until after submission and must not
expand the frozen demo scope:

- Should a later release collect any administrative field beyond the three
  frozen closeout question families?
- What additional evidence would a dispatcher need without storing a full
  transcript?
- What is the maximum permitted retry policy after no answer or voicemail?
- Which parts of the workflow should become configurable after the demo?
