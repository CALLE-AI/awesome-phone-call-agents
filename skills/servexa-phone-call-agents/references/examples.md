# SERVEXA Usage Examples

These examples use fictional data only. The phone number `+12025550100` is reserved for documentation and must not be dialed.

## Preview A Directed Call

Use the directed-call wizard to prepare a payment confirmation conversation:

```text
Customer: Example Customer
Phone: +12025550100
Template: Payment Confirmation
Amount: USD 125.00
Question: Confirm whether the customer sent the payment and ask for the payment date if they did.
Context: The account record needs verification before any balance is discussed.
```

The Review step displays the selected customer, template, amount, and instruction. This is a no-call preview. It does not contact CALL-E, reserve a phone attempt, or create a provider call.

Before selecting Initiate Call, an authorized operator must confirm the customer, recipient, objective, contact permission, calling time, and required consent or disclosure.

## Initiate A Live Call

After authorization, the operator selects Initiate Call. SERVEXA creates its local `calls` record, stores the optional `call_instructions` record, and sends CALL-E a task with:

- a customer-care objective;
- one E.164 recipient;
- a structured result schema;
- internal correlation metadata;
- the webhook URL.

The result is asynchronous. A queued or initiated response is not a completed call. The operator waits for Activity or uses Refresh status while CALL-E is still processing.

## Review A Completed Call

After CALL-E reaches a terminal state, open Activity and select the call row. The report may show:

```text
Status: completed
Outcome: follow_up_needed
Summary: The customer requested a callback to discuss a payment arrangement.
Sentiment: neutral
Next action: Arrange an authorized human callback.
Transcript: Available when CALL-E returns transcript turns.
Follow-up: Pending, with its due date and completion control.
```

The summary is provider-returned evidence and is not a substitute for the transcript. If no transcript or structured result is returned, the report must say that it is unavailable or unknown.

## Failed Or Ambiguous Call

If CALL-E reports a failure, the local call remains failed and the report explains that no reliable outcome was recorded. If the customer response is contradictory or insufficient, use `unknown` and route it for human review. Do not infer payment status, identity, consent, or a commitment.

## Cancellation And Opt-Out

If the operator cancels during preview, no CALL-E request is sent. If the customer asks to stop, withdraws consent, or opts out during a conversation, stop and do not retry without fresh authorization. The current client has no live cancel button after initiation; any post-initiation cancellation must use a provider-supported cancellation mechanism and be confirmed in the local status.
