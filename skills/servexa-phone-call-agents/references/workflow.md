# SERVEXA Phone Call Workflow

## 1. Customer Selection

The operator opens Customers. `src/app/customers.tsx` loads `id`, `name`, `phone`, `status`, and `created_at` from Supabase after `ensureSession()` establishes an anonymous authenticated session for RLS.

The operator can:

- search and filter customers;
- add a customer with a name and phone number;
- open a customer detail view;
- start a standard call;
- open the directed-call wizard with the selected customer already passed in.

Customer records are scoped by the Supabase session owner. A new anonymous browser session does not automatically see another session's records.

## 2. Call Objective

A standard call sends a general customer-care task. A directed call starts at `src/app/call-instruction.tsx` and uses four steps:

1. Select customer.
2. Select a template.
3. Provide details and human-directed instructions.
4. Review and initiate.

The six implemented templates are:

- `loan_recovery`
- `payment_reminder`
- `payment_confirmation`
- `customer_followup`
- `repayment_assistance`
- `account_inquiry`

The wizard can collect `custom_question`, `custom_context`, `amount`, `currency`, `due_date`, and `reference_info`. At least a question or amount is required before review.

Before continuing to initiation, the operator must confirm that the customer, number, objective, contact permission, calling time, and required consent are appropriate. The review step is the current preview boundary. There is no implemented CALL-E dry-run mode; choosing Review does not contact the customer.

Example of a fictional, masked recipient used for testing documentation only:

```text
Customer: Example Customer
Phone: +12025550100
Objective: Confirm whether a payment was received
Template: Payment Confirmation
```

## 3. Local Call Record

The client invokes the `start-customer-call` Supabase Edge Function. The function:

1. validates the customer or normalizes a direct phone number;
2. creates a `calls` row with status `queued`;
3. creates a `call_instructions` row when template or custom instructions exist;
4. builds the SERVEXA customer-care prompt;
5. sends the request to CALL-E;
6. stores CALL-E's returned `id` as `provider_call_id`;
7. marks the local call `initiated`.

The internal call ID is sent in CALL-E metadata as `servexa_call_id` and is used as the `Idempotency-Key`.

If the operator cancels before initiation, no CALL-E request should be made. If the customer cancels, opts out, or asks not to be contacted during the conversation, stop the workflow and do not retry without fresh authorization. The current client does not provide a live cancel button after initiation; provider cancellation and local status confirmation are required for post-initiation cancellation.

## 4. CALL-E Conversation

CALL-E receives:

- the natural-language `task`;
- one recipient with an E.164 phone number, region, and locale;
- a strict `result_schema`;
- internal correlation metadata;
- the public `calle-webhook` URL.

The task combines the SERVEXA persona, customer name, objective, template context, and operator instruction. The result schema asks CALL-E to extract outcome, customer summary, sentiment, payment status, stated difficulty, promised payment date, follow-up requirement, escalation reason, and next action.

The result schema guides extraction after the conversation. It does not prove that every spoken question was asked or that every result field is correct; operators should review the report and evidence.

If the evidence is ambiguous, contradictory, or missing, CALL-E or SERVEXA should record an `unknown` outcome or route the call for human review. The agent must stop when identity, consent, or required financial facts cannot be safely established, or when the customer requests a human or no further contact.

## 5. Terminal Event And Persistence

CALL-E sends terminal events to `calle-webhook`:

- `call.completed`;
- `call.failed`;
- `call.result_validation_failed`.

The webhook validates the `CALL-E-Event-Id` header against the event body ID, reads `data.metadata.servexa_call_id`, locates the local call, and persists:

- terminal call status and timestamps;
- duration when timestamps are available;
- provider call ID;
- transcript assembled from recipient attempt transcript turns;
- `call_outcomes` with summary, outcome, sentiment, and action required;
- `activities` for the Activity screen;
- `follow_ups` when an escalation reason is present.

Webhook delivery is at-least-once. Existing terminal calls are treated as duplicates to avoid repeating side effects.

## 6. Delayed Webhooks

Activity's Refresh status action finds local calls that are still `queued`, `initiated`, `ringing`, or `in_progress` and have a provider ID. It invokes `sync-call-status` for each one.

`sync-call-status` fetches `GET /v1/calls/{provider_call_id}` from CALL-E. If the call is terminal, it backfills the same call, outcome, activity, and follow-up records used by the webhook path.

## 7. Operator Review

The Activity screen lists persisted interactions. A row with a `call_id` opens `src/app/call-detail.tsx`.

The report presents:

- status and customer;
- outcome and provider summary;
- sentiment and recommended next action;
- full transcript when returned;
- duration and timestamps;
- follow-up tasks and due dates;
- a control to mark a follow-up complete.

If an outcome or transcript is unavailable, the report says so. It should not fill gaps with invented content.

## 8. Data Model

The core tables are:

- `customers`: customer identity and contact details;
- `calls`: internal lifecycle, provider ID, timestamps, transcript, and status;
- `call_templates`: seeded template reference data;
- `call_instructions`: per-call operator instructions and context;
- `call_outcomes`: structured terminal outcome and summary;
- `activities`: dashboard activity records;
- `follow_ups`: actionable work created from calls or escalations;
- `campaigns`: schema exists, but campaign automation is not connected in the current client.

RLS policies scope user-owned records by `owner_id`. Edge Functions use the service role server-side for provider callbacks and persistence.

## 9. Testing Path

For a manual review:

1. Run `npm run web`.
2. Open `/customers`.
3. Add a permitted test customer with an E.164 number.
4. Choose a template or open the directed-call flow.
5. Add a specific question or amount context.
6. Initiate the call only when a real CALL-E configuration and consent are in place.
7. Open Activity after the call.
8. Use Refresh status if the webhook is delayed.
9. Open the activity row and review the report, transcript, and follow-up.

Do not use production customer data for development tests without authorization.
