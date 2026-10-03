# Safety Reference

## Consent and purpose

- Only call a customer about the specific order or service they just completed. The call task must state the business name and the reason for the call in its opening line.
- Never reuse this workflow for marketing, upsell, collections, or survey campaigns unrelated to the completed order.

## Phone numbers

- Store and pass phone numbers in E.164 format.
- In samples, docs, and tests, use standards-reserved fictional numbers (for example the `+1-555-0100`–`+1-555-0199` range), never a real person's number.
- Mask phone numbers in any summary, log line, or notification that a human will read; keep the raw number only where the call-placement code needs it.

## Idempotency and duplicate calls

- Derive the idempotency key from the order id (`order-{order_id}`), not from a timestamp or random value, so retried dispatch triggers (webhook redelivery, queue reprocessing, a restarted worker) cannot place a second call for the same order.
- Action-triggered outreach calls (for example a follow-up compensation-offer call) must use a separate, action-scoped idempotency key — never the same key as the original feedback call — so the two purposes can never collide or suppress each other.

## Retry boundaries

- Only a *verified, terminal* `no_answer` is retry-eligible. `voicemail`, `completed`, and `canceled` must never be retried, and neither must `failed` or any ambiguous/unresolved outcome — `failed` can mean a transient provider/network error rather than a confirmed customer non-contact; treating it the same as a verified `no_answer` would silently keep redialing on a signal that was never actually confirmed. Hold those for reconciliation instead.
- Cap retries at one additional attempt after a short fixed delay. Do not create an unbounded or exponential retry loop for a phone call — a human should see "could not reach the customer" rather than the workflow silently redialing.

## Credential handling

- Load the CALL-E API key and webhook base URL from environment/config, never hardcode them, and never include them in a task instruction, metadata payload, or log line.
- The webhook endpoint must validate that the payload actually corresponds to a call this system placed (via the idempotency key or a stored call id) before acting on it.

## Data handling

- Raw audio is never stored.
- Only the customer-side transcript text needed for structured extraction should be processed in memory; do not forward the full raw transcript to a human notification channel. Human-facing messages carry the structured result and a short generated summary, not a transcript dump.
- Do not include another customer's data, a different order's details, or unrelated PII in the call-task instruction, even when a follow-up question references a prior reported issue — only verified canonical issue names, never a raw complaint quote.

## Human authority boundary

- This skill's own authority ends at producing a recommendation (for example "urgent — missing item: X"). Refunds, compensation, discount codes, or any other corrective action must go through a separate, explicitly human-approved step. A triage agent may propose; it must not execute.
- If no LLM/analysis provider is available, the workflow must fail safely: skip the recommendation step rather than fabricate a generic or unsupported conclusion.
