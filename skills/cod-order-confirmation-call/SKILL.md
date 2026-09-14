---
name: cod-order-confirmation-call
description: Prepare one authorized cash-on-delivery order confirmation call. Compiles a CALL-E brief and advisory result schema from order rows, leaving result validation and status changes to the calling system or a human. Dry-run preview by default.
license: MIT
---

# COD Order Confirmation Call

Use this skill when a shop, marketplace or chat-commerce system has explicit authority to place **one** disclosed phone call to confirm a **cash-on-delivery order the customer already placed**. The call reads back the items and total exactly as recorded, confirms the delivery address, records requested changes, and returns a structured disposition. It never invents items, prices or delivery promises.

This skill does not execute calls, validate returned results or change order status itself. The compiler prepares a task and schema; the host must review the advisory result before applying its own rules. The external reference uses heuristic confirmation and cancellation rules, not a guarantee that every ambiguous answer reaches a human.

## When To Use

- Confirm a COD order that arrived through WhatsApp, Instagram, Messenger, a web shop or a marketplace
- Reduce fake, duplicate or forgotten COD orders before goods are prepared and dispatched
- Capture an address correction or an item change the customer asks for
- Produce an evidence-backed disposition for the operations team

## When Not To Use

- First-contact sales, upselling or unsolicited marketing
- Collecting card details, ID numbers, or any payment on the call
- Medical, legal, financial, collections or political calls
- Calling a number that did not come from the order record
- Hidden retries or recurring reminder schedules

## Required Inputs

- `order_ref`: short human reference read on the call
- `business_display_name`: name disclosed on the call
- `customer_name` (optional) and `to_phone_e164` (E.164, from the order record)
- `items[]`: `{ name, variant?, quantity, unit_price }` **from the order rows**, not from a chat transcript
- `currency`, `total`, optional `delivery_fee`
- `delivery_address` (optional — if absent the caller collects it)
- `delivery_policy` (optional short text the caller may quote)
- `language` (optional), `timezone` (IANA)
- `consent`: must be true; `do_not_call`: must be false

## Preflight

1. Confirm the operator or the calling system authorized this one confirmation call.
2. Confirm `to_phone_e164` came from the order record and is in a CALL-E supported country.
3. Refuse if `do_not_call` is true, `consent` is not true, or the order has no items.
4. Run the local preview before any CALL-E plan.

## Dry-Run Preview

From the repository root (no CALL-E credentials, no network):

```bash
python3 skills/cod-order-confirmation-call/scripts/build_task.py skills/cod-order-confirmation-call/assets/sample-order.json
```

Prints display copies of the compiled CALL-E task, `result_schema`, and idempotency key with phone-like text masked throughout. It does not dial. The internal `build(order)` result retains the private task for a separately authorized host integration; do not treat masked preview output as an approved live payload.

## CALL-E Goal Template

```text
You are calling on behalf of {business_display_name} to confirm a cash-on-delivery order
before it is prepared and dispatched. Disclose that you are an AI assistant.
Customer: {customer_name}. Order reference {order_ref}, placed {placed_at_friendly}.
Items: {quantity} x {item} at {unit_price}; ...
Delivery fee: {delivery_fee}. Total to pay in cash on delivery: {total}.
Delivery address on file: {delivery_address} (or: No delivery address is on file — ask for it).
Delivery policy: {delivery_policy}.
Goal: 1) greet and say you are calling from the shop to confirm their order; 2) read back the
items and the total; 3) confirm the delivery address or collect it; 4) ask if they want any
change and record it precisely; 5) if they no longer want the order, accept politely.
Rules: never invent items, prices, discounts or delivery times not in this brief. If asked
something you do not know, say a team member will follow up. Keep the call under two minutes.
On voicemail, leave a short message saying who you are and end the call.
```

## Structured Result

```json
{
  "disposition": "confirmed | changed | cancelled | voicemail | no_answer | wrong_number | needs_human",
  "confirmed": "yes | no | unknown",
  "address_correct": "yes | no | unknown",
  "delivery_address": "as stated by the customer, or empty",
  "requested_changes": "exact changes requested, or empty",
  "preferred_delivery_window": "stated preference, or empty",
  "customer_notes": "anything else the team should know"
}
```

Only `disposition = confirmed` **and** `confirmed = yes` with high completion confidence should flip an order to confirmed. `changed`, `voicemail`, `no_answer`, `wrong_number`, `needs_human` and any low-confidence result need a human. `cancelled` may cancel the order only if the calling system's rules allow it.

## Live Planning And Execution

The following SDK call **executes a real call; it is not a plan**. Run it only after final per-call approval of the reviewed task and authorized E.164 destination, and CALL-E authentication:

```ts
import { CalleClient } from "@call-e/calle";
const client = new CalleClient({ apiKey: process.env.CALLE_API_KEY! });
const call = await client.calls.create(
  { task, recipients: [{ phones: ["<E164_PHONE>"], region: "<REGION>" }], resultSchema, recipientResultSchema: resultSchema, metadata: { order_ref } },
  { idempotencyKey: `cod-confirm:${order_ref}:1` },
);
```

Planning via the CALL-E CLI is also valid and is not execution:

```bash
calle call plan --to-phone <E164_PHONE> --goal "<reviewed task text>" --timezone Asia/Beirut --language English --region GB
```

For the CLI, do not execute the resulting plan unless the operator or calling system separately confirms this call. Creating a plan alone is not that approval.

## Cancellation And Idempotency

Idempotency key: `cod-confirm:{order_ref}:{attempt}`. Persist it before the first request and reuse it on retries. One call per order per attempt; never retry automatically on `unknown`, voicemail or no answer — route to a human.

Before submission, cancel by discarding the preview or plan. After submission, stopping this script or closing a page does not recall an accepted call. Use supported provider controls and treat cancellation as unconfirmed until the provider confirms it. Reconcile an unknown outcome before authorizing another attempt; a stable key is not a crash-proof or permanent duplicate-prevention guarantee.

## Reference Implementation

FrontDesk Phone Follow-Through (see `docs/community-apps/frontdesk-phone-follow-through.md`) runs this skill inside a multi-tenant WhatsApp AI front desk: a **Confirm by phone** button on the Orders page and an optional auto-confirm timer, with the result written back to the order and posted as a note in the customer's inbox thread.

## Safety Notes

Read `references/safety.md` and `references/examples.md` before live planning.
