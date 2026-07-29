# Safety Reference

## Call Boundary

An invoice-exception briefing is a one-time communication to a verified manager. It is not an approval, payment instruction, or authority grant. The call must direct the manager to the existing human review experience for every decision.

## Redaction

Use the least information needed to identify the exception and its business context. Do not include credentials, bank-account data, full invoices, customer or vendor personal data, unrestricted records, or private call content.

## Dispatch Checks

Before dispatch, require explicit user confirmation, a verified E.164 destination, recipient role verification, tenant/workspace/scope match, an enabled kill switch, and a new idempotency key. If any check fails, do not place the call.

## Retry and Cancellation

Cancel before dispatch through the kill switch or an explicit cancel request. Do not automatically retry an unanswered, failed, or provider-rejected call. A later call requires a new explicit request and a new idempotency key.

## Reporting

Report only a minimal status and masked destination. Do not retain or publish the full phone number, credential, voicemail, call recording, or transcript.
