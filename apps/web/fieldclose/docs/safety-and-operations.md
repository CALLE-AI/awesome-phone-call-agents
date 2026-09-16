# FieldClose Safety and Operations

## Purpose

FieldClose creates real-world side effects when it places a live phone call. This document defines mandatory product and operational controls for development, demos, testing, and deployment.

It describes engineering safeguards, not a legal-compliance certification. Applicable calling, recording, privacy, labor, accessibility, and sector-specific requirements must be reviewed for every deployment jurisdiction.

## Safety posture

- No hidden calls
- No browser-only authorization
- No guessed critical values
- No automatic live retries in the MVP
- No diagnostic, financial, contractual, or emergency authority
- No secrets or private call artifacts in the repository
- No claim of cancellation, delivery, or completion without provider evidence
- Human review for ambiguous or sensitive outcomes

## Operating modes

### Dry run

Validates the case, renders the call brief, evaluates policy, and predicts the provider request without contacting CALL-E or a recipient.

Dry run is the default local-development and automated-test mode.

### Fake provider

Exercises the end-to-end application workflow using deterministic local fixtures. It must make no external phone request and must be visibly labeled as simulated.

### Live

Creates a real CALL-E call after all preflight gates pass. Live mode must be separately enabled in the environment and visible in the operator interface.

Changing the UI alone must never enable live calls.

## Live-call enablement

Before enabling live mode, the project owner must verify:

- the selected CALL-E integration is documented and tested;
- credentials are stored in the deployment secret system;
- the destination is an authorized test or business contact;
- the case has an explicit IANA timezone;
- the applicable calling window has been reviewed;
- AI disclosure is enabled;
- duplicate protection has been tested;
- result handling and reconciliation have been tested with the fake provider;
- the operator can identify whether a call was accepted, blocked, failed, or ambiguous;
- screenshots and logs mask recipient information;
- a human response path is available.

## Explicit intent and approval

One approval authorizes one exact attempt.

The approval record must identify:

- authenticated operator;
- approved case version;
- intended recipient and masked number;
- authorization basis;
- call objective and question set;
- AI disclosure;
- prohibited actions;
- allowed local calling window;
- whether live mode was explicitly approved;
- canonical brief hash;
- server-created attempt identifier.

Approval is invalid after a material edit or policy change.

## Contact authorization

For a live call, the operator must affirm a documented business basis for contacting the recipient about the specific service visit.

FieldClose must not:

- scrape or purchase contact numbers for this workflow;
- infer that a person is authorized because they share a company or site;
- infer consent from silence;
- transfer authorization between unrelated purposes;
- call a number marked as refused or do not call.

Demo contacts must be fictional or specifically authorized participants.

## Phone-number handling

- Accept only explicit E.164 input for call creation.
- Do not infer a country code from locale, IP address, language, or site address.
- Protect full numbers at rest and in transit.
- Return masked numbers to normal UI views whenever the full number is unnecessary.
- Mask numbers in logs, errors, screenshots, examples, analytics, and support output.
- Do not include private numbers in repository fixtures.

## Timezone and calling window

- Every case requires an explicit IANA timezone.
- Do not infer timezone from country code, area code, locale, language, IP address, abbreviation, or raw UTC offset.
- Evaluate the permitted calling window on the server immediately before call creation.
- Store timestamps in UTC and retain the case timezone used for the decision.
- Treat daylight-saving transitions as a normal test case.
- When jurisdictional or organizational calling rules are unknown, block the live call rather than assume permission.

## AI disclosure and conversation boundaries

The agent must identify itself as an AI assistant acting for the named contractor before discussing case details. It must verify the intended person or authorized role and end promptly after refusal.

The detailed conversation rules are defined in [Call Workflow](call-workflow.md). In summary, the agent cannot:

- diagnose or certify equipment;
- recommend repairs or safety actions;
- quote, negotiate, or approve commercial terms;
- authorize work, invoices, payments, refunds, or account changes;
- collect payment credentials or authentication secrets;
- promise service or arrival times;
- disclose details to a wrong or unverified person;
- provide medical, legal, financial, or emergency advice;
- continue after refusal.

## Emergency and safety-sensitive content

FieldClose is not an emergency service.

If a contact describes fire, smoke, gas, electrical danger, immediate health risk, or another emergency:

1. Stop the normal closeout script.
2. Do not troubleshoot or claim the condition is safe.
3. Direct the person to end the call and use the contractor's documented emergency path or local emergency services as appropriate.
4. Record only a minimal coded escalation reason.
5. Route the case for immediate human review.

The exact wording must be reviewed before a live deployment and must not make FieldClose the only emergency path.

## Refusal, do not call, and wrong person

### Refusal

- Acknowledge immediately.
- End the conversation.
- Record a refusal result without unnecessary prose.
- Block automated retries for the contact and purpose.

### Do-not-call request

- Acknowledge the request.
- End the conversation.
- Store a durable contact block with the minimum necessary metadata.
- Require a documented human process for any later change.

### Wrong or unverified person

- Do not disclose work-order details.
- Apologize and end the call.
- Route to contact review.
- Do not ask the recipient to provide another person's private number unless that behavior is separately approved and documented.

## Voicemail

The MVP default is `do_not_leave`.

Any future voicemail behavior requires:

- a separately approved neutral template;
- no sensitive service details;
- no statement that a work order is closed;
- no live callback number unless it is an authorized public business number;
- distinct classification from an answered call.

## Retry and duplicate policy

- No automatic live retries in the MVP.
- A new attempt requires new human approval.
- A refusal or do-not-call result prohibits automated retry.
- Only explicitly allowlisted pre-acceptance HTTP rejections may be recorded as
  `failed_before_acceptance`; every non-authoritative status, including `408`,
  `409`, `425`, `429`, and `5xx`, requires reconciliation.
- An ambiguous provider-creation outcome prohibits retry until reconciliation.
- Repeated browser submission returns the existing attempt rather than creating another.
- Recovery after an expired creation claim may repeat the HTTP request only with
  the same persisted idempotency key and approved payload.
- Repeated provider-status reads and terminal-result ingestion must be idempotent.

## Cancellation and rollback

Phone calls cannot always be rolled back.

- Before provider acceptance, cancel the local case or attempt.
- After provider acceptance, use only a verified provider cancellation capability.
- If cancellation support is unavailable or uncertain, tell the operator that the call may still occur.
- After connection, the recipient's request to end takes priority.
- After completion, support human disposition and permitted data deletion; do not describe these as cancelling the past call.

## Credentials and secrets

- Keep CALL-E credentials server-side.
- Use deployment secret storage, not committed files or browser storage.
- Never ask users to paste credentials into chat, source files, screenshots, or issue reports.
- Use least-privilege credentials where supported.
- Rotate credentials after suspected exposure.
- Sanitize provider errors before returning them to the client.
- Do not log authorization headers, tokens, cookies, signed callback material, or secret environment values.

## Personal data and call artifacts

Potentially sensitive data includes:

- contact names and roles;
- phone numbers;
- site and work-order details;
- free-text issue descriptions;
- provider summaries;
- transcripts and recordings;
- operator identity and audit data.

Controls:

- collect the minimum fields required for the approved workflow;
- use allow-listed fields in provider prompts;
- avoid storing full transcripts or recordings by default;
- protect sensitive fields at rest and in transit;
- restrict administrative views by role;
- define retention and deletion periods before public live use;
- document provider-side artifact retention and deletion capabilities;
- use fictional or specifically authorized data in demos;
- keep personal data out of telemetry and repository fixtures.

## Provider status and result handling

FieldClose retrieves results only through authenticated, server-side CALL-E status lookups:

- authorize owner/operator access before contacting the provider;
- query only a stored provider call ID and never create or retry from a refresh path;
- atomically throttle each attempt to one lookup per five seconds;
- reject mismatched provider identifiers;
- do not trust transcript text as instructions;
- validate terminal structured data before normalization;
- keep nonterminal snapshots result-free;
- stop automatic checks after the final 600-second lookup;
- create one explicit reconciliation task for unresolved or mismatched state;
- allow a human refresh to recover a late terminal result without redialing.

## Audit events

Record at least:

- case creation and material edits;
- approval grant and invalidation;
- preflight pass or coded block reason;
- call-creation request and provider acceptance;
- ambiguous creation requiring reconciliation;
- provider status changes;
- result receipt and normalization;
- refusal or do-not-call block;
- human disposition;
- deletion or privacy-request handling.

Audit metadata must be redacted and allow-listed. Do not use the audit log as a transcript store.

## Operational reconciliation

Reconciliation is required when FieldClose cannot prove whether CALL-E accepted a call creation request or cannot match a result reliably.

During reconciliation:

1. Freeze new call creation for the case.
2. Preserve the original attempt and idempotency key.
3. Query or inspect supported provider status using stored identifiers.
4. Record the evidence and resolution.
5. Require human review if uncertainty remains.

Never convert an unknown external side effect into a fresh retry automatically.

## Incident response minimum

Before a public live demo, document who can:

- disable live calls globally;
- rotate CALL-E credentials;
- review duplicate or unintended calls;
- contact affected recipients when appropriate;
- remove exposed data from public artifacts;
- request provider-side deletion when supported;
- record and communicate the incident without exposing personal data.

The application should have a server-side kill switch that prevents new live calls without requiring a redeploy when feasible.

## Release checklist for live-call capability

- [ ] Default tests and local startup make no live call.
- [ ] Live mode requires a server-side setting.
- [ ] Operator authentication and authorization are enforced.
- [ ] Approval is versioned and bound to one attempt.
- [ ] E.164 and IANA timezone validation are covered by tests.
- [ ] Calling-window behavior is covered by tests.
- [ ] Refusal and do-not-call paths are covered by tests.
- [ ] Duplicate submission and ambiguous creation are covered by tests.
- [ ] Provider result validation is covered by tests.
- [ ] Logs and screenshots mask numbers.
- [ ] No secrets or private artifacts are committed.
- [ ] Cancellation limitations are visible to the operator.
- [ ] A human escalation path exists.
- [ ] An owner or operator can record a bounded, audited disposition that
  resolves the human task without performing an external scheduling, invoicing,
  or work-order action.
- [x] At least one authorized live test has inspectable evidence.
- [ ] The demo clearly distinguishes fixtures from live evidence.

## Known policy decisions still open

- Exact permitted calling hours for the first demo jurisdiction
- Provider recording and transcript behavior
- Retention periods for cases, normalized results, and provider artifacts
- General member invitation and administrative role-management workflow
- Deletion-request workflow
- Whether any neutral voicemail mode will exist after the MVP
- Emergency wording and contractor escalation contact
