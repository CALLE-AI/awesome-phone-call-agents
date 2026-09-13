# Safety Reference

Supplier clarification calls are real-world side effects. Default to a dry run and stop whenever recipient authorization, scope, or provider state is ambiguous.

## Authorization And Consent

Require a structured outreach basis for the exact recipient and RFQ. Accepted types are explicit recipient consent, an existing supplier relationship, or an inbound request that asked for follow-up, each with a recipient-specific reference. A generic contact list or public website is not sufficient.

Do not call a third party based only on the user's possession of a phone number. Do not infer consent from a company website, caller ID, country code, locale, or previous unrelated contact.

## Phone Numbers

Require E.164 format. Documentation examples may use reserved fictional numbers such as `+15550101234`.

Mask destinations in previews, logs, durable results, issue comments, and summaries. The full number may appear only in the private provider execution payload.

## Information Boundaries

The call may disclose only the facts listed in `allowedContext`. Exclude credentials, private personal data, export-controlled content, classified information, and proprietary data that the user has not authorized for this recipient.

The call may collect factual RFQ clarifications. It must not:

- negotiate or accept commercial terms
- make commitments about price, delivery, capacity, quality, warranty, or liability
- approve a supplier, quote, purchase order, deviation, or production release
- provide legal, medical, financial, emergency, or regulatory advice
- record payment credentials, passwords, government identifiers, or secrets

If the recipient introduces a commercial decision, record that a human follow-up is needed and return to the approved factual questions.

## Execution Gate

Before a real call, verify:

1. The user authorized this exact task or an existing runtime contract covers it.
2. The outreach basis applies to this recipient.
3. The phone number is E.164.
4. The question count is between one and eight.
5. Every question is factual and within scope.
6. The allowed context is sufficient and contains no prohibited data.
7. A human or authorized agent reviewed the exact free text and supplied the matching content hash.
8. The idempotency key, which binds every safety-relevant field, is not active or completed.
9. The CALL-E route is authenticated and compatible tools are available.
10. The provider plan matches the approved preview.
11. The durable structured result target is a writable, new local CSV path.

Any failed gate blocks the call.

## No Hidden Side Effects

Place at most one call for an approved task. Do not schedule recurring calls. Do not retry automatically. Do not silently write to an unapproved system.

The dry-run validator never performs network requests, writes results, or calls a provider. Unreviewed free text returns `pending-safety-review`, not `dry-run`; any edit to a reviewed field invalidates the content-bound approval.

## Recipient Control

State the caller identity and purpose at the start. Let the recipient decline, request a human, or stop the call. End promptly when asked.

Do not use deceptive identity claims, artificial urgency, pressure, or repeated objections. Follow applicable call-recording and disclosure laws; if recording permission is required and cannot be verified, do not record.

## Results And Retention

Store structured answers rather than a full transcript. Mask the phone number. Do not expose provider credentials or confirmation tokens.

Recheck provider history before recording `no-answer` or `failed`. If the provider outcome is ambiguous, report `blocked` or `partial` and request human review.
