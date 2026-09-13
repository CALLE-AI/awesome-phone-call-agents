# Safety Reference

## Call Boundary

An invoice-exception briefing is a one-time communication to a verified manager. It is not an approval, payment instruction, or authority grant. The call must direct the manager to the existing human review experience for every decision.

Before disclosing invoice context, the callee must positively confirm that they are the verified manager. If the call reaches voicemail, an answering service, an unconfirmed person, or an ambiguous response, end it without leaving a message or disclosing the exception.

## Redaction

Use the least information needed to identify the exception and its business context. Do not include credentials, bank-account data, full invoices, customer or vendor personal data, unrestricted records, or private call content.

## Dispatch Checks

Before dispatch, require explicit user confirmation, a verified E.164 destination, recipient role verification, tenant/workspace/scope match, an armed cancellation control that is not cancelled, and an idempotency key. Persist an atomic durable reservation for that key before dispatch. If any check fails, do not place the call.

## Retry and Cancellation

Cancel before provider acceptance through the cancellation control or an explicit cancel request. Provider acceptance is the point of no return: after it, do not dispatch another call or retry. If the provider supports cancellation, request it through the same server-side operation, but do not promise an accepted call can be stopped.

Treat a timeout or ambiguous provider response as `outcome-unknown`; reconcile the original reservation under the same idempotency key. Never create a new-key retry until the original attempt is confirmed absent. Do not automatically retry an unanswered, unconfirmed, failed, or provider-rejected call. A later call requires a new explicit request after the original attempt has a known terminal outcome.

## Off-Topic Boundaries

Do not use this workflow for medical, legal, or emergency advice, triage, or response. If a callee raises an emergency, stop the workflow and direct them to local emergency services or the appropriate emergency contact. If they seek medical or legal advice, state that the call cannot provide it and direct them to a qualified professional.

## Reporting

Report only a minimal status and masked destination. Do not retain or publish the full phone number, credential, voicemail, call recording, or transcript.
