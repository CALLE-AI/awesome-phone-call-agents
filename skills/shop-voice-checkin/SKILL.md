---
name: shop-voice-checkin
description: Place consent-based outbound CALL-E phone check-ins with informal African and Indian retailers to capture morning inventory and evening sales through natural voice conversation, then return structured shop data for a voice-first business manager workflow.
license: MIT
---

# Shop Voice Check-in

Use this skill when a **shop owner has opted in** to regular phone check-ins instead of entering data into an app. The agent calls, speaks in simple English, Pidgin-influenced English, or Hindi-English (Hinglish), asks about stock and sales, and returns **structured JSON** for a local shop ledger.

This skill is the voice layer of **Voice Shop Manager** — "your business manager, on the phone."

## When to use

- **Morning inventory check-in** — approximate stock levels, low items, supplier mentions
- **Evening sales recap** — approximate daily revenue, top sellers, restock spend
- Voice-first workflows for informal retailers in Nigeria, West Africa, or similar markets (India via English/Hindi task variants)

Pair with the runnable app at `apps/python/shop-voice-manager/` (relative to this submission repository root) to persist results in SQLite and generate weekly summaries.

**Demo mode:** Default hackathon path uses fixtures — no live call. See `references/demo-mode.md`.

## When not to use

- Cold-calling retailers who did not consent
- Loan offers, credit scoring conversations, or regulated financial advice on the call
- Replacing a POS, accounting system, or tax filing workflow
- Batch supplier procurement calls without explicit authorization per recipient
- Recurring schedules without a separate scheduler wrapper — see [`call-reminder`](../call-reminder/)

## Required fields

For each call, require:

- `shop_id` — stable identifier for the retailer
- `call_type` — `inventory`, `sales`, `reorder_offer`, `vendor_order`, `order_status`, or `onboarding`
- `phone` — E.164 number of the **consenting shop owner** (or, for `vendor_order`, the consenting vendor)
- `region` — CALL-E region code, e.g. `NG` or `IN`
- `locale` — CALL-E locale, e.g. `en`
- `recipient_consented` — must be `true` for live calls

Optional:

- `currency` — `NGN`, `INR`, etc.
- `language_style` — `pidgin-english`, `english`, or `hindi-english`
- `products_to_ask` — short list for morning check-ins
- `timezone` — IANA name for scheduling context

Ask for any missing required field. Do not infer phone, region, locale, or timezone from context.

## Core workflow

1. Read `references/safety.md` and confirm **recipient consent**.
2. Choose call type: inventory (morning) or sales (evening).
3. Build task text from `references/call-scripts-pidgin.md`, `references/call-scripts-english.md`, or `references/call-scripts-hindi-english.md`.
4. Attach the matching result schema:
   - inventory → `references/result-schema-inventory.json`
   - sales → `references/result-schema-sales.json`
   - reorder_offer → `references/result-schema-reorder-offer.json`
   - vendor_order → `references/result-schema-vendor-order.json`
   - order_status → `references/result-schema-order-status.json`
   - onboarding → `references/result-schema-onboarding.json`
5. **Preview first** — inspect the planned task and schema without placing a call.
6. Live call — only with explicit user approval and `--execute`-style confirmation in the runnable app.
7. Pass structured results to the shop ledger app or host workflow.

Use this shape:

```text
consent check -> build task + schema -> preview -> live call -> structured result -> shop ledger
```

## Call task template (inventory)

```text
Call the shop owner for a short morning inventory check-in. Match language_style:
Pidgin for pidgin-english, plain English for english, Hindi-English mix for
hindi-english. Ask about: {{products_to_ask}}. For each product, capture
approximate quantity and unit. Ask what is running low. Also ask once whether
they added any new goods not on that list; if yes, capture name, quantity, and
unit so the ledger can add them. Disclose you are an AI assistant for their shop
manager service. Keep the call under {{max_minutes}} minutes. Do not give
financial advice.
```

## Call task template (sales)

```text
Call the shop owner for a short evening sales recap. Ask roughly how much they
sold today, what sold best, and whether they bought stock for the shop today.
Disclose you are an AI assistant for their shop manager service. Keep the call
under {{max_minutes}} minutes. Do not give financial advice.
```

## Call task template (reorder offer)

```text
Call the consenting shop owner. Tell them the following is running low:
{{low_stock_items}}. Ask if they want to place a restock order. If yes, ask quantity
needed per item, then ask which vendor to use. If it is a vendor already on file, do
not ask what they sell or their phone number again. If it is a new vendor, explicitly
ask two more questions before ending the call: what the vendor sells, and the
vendor's phone number — do not skip the phone number just because the owner did not
offer it; ask for it directly. If the owner truly does not have it, say the vendor
cannot be called yet without it. Never invent a vendor phone number. If no, end
politely; do not place any vendor call. Disclose you are an AI assistant. Keep the
call under {{max_minutes}} minutes. Do not give financial advice or discuss loans.
```

## Call task template (vendor order)

```text
Call {{vendor_display_name}} on behalf of {{shop_id}}. Disclose you are an AI
assistant calling on their behalf. State you are calling to place an order for
{{order_items}}. Ask if they are available, the price if they wish to share
it, and an estimated delivery time. Do not discuss payment, bank details, or
loans.
```

## Call task template (order status)

```text
Call the consenting shop owner with a short update on their restock order.
Disclose you are an AI assistant. Tell them exactly the known outcome from the
vendor call — placed, unavailable, or delayed — plus the ETA and amount if
known. Do not leave the outcome for the model to guess; a task with no known
outcome to report should not be created. Keep under 2 minutes. Do not give
financial advice.
```

## Call task template (onboarding)

```text
Call the consenting new shop owner. Disclose you are an AI assistant. Explain
you will collect basic shop details to set up their account: shop name, phone
number (read back to confirm), region, and language. Ask for 3 to 5 staple
products they sell and, optionally, one preferred supplier's name. Ask for
consent to store this information and to make future check-in calls. Do not
infer region, locale, or currency — ask explicitly. Keep under {{max_minutes}}
minutes.
```

## Idempotency

Use one idempotency key per shop, call type, and calendar day for `inventory`,
`sales`, `reorder_offer`, and `onboarding`. `vendor_order` and `order_status`
key on the restock request instead, since a shop may restock more than once a
day:

```text
shopvoice-{shop_id}-inventory-{YYYY-MM-DD}
shopvoice-{shop_id}-sales-{YYYY-MM-DD}
shopvoice-{shop_id}-reorder_offer-{YYYY-MM-DD}
shopvoice-{shop_id}-vendor_order-{request_id}
shopvoice-{shop_id}-order_status-{request_id}
shopvoice-{shop_id}-onboarding-{YYYY-MM-DD}
```

Phase 3 payout key: `vendor_pay` — see `references/result-schema-payment-consent.json`.

## Runnable app

The reference runner lives at `apps/python/shop-voice-manager/`. Default mode is preview (no network call). See the app README for live opt-in flags.

## Assets

- `assets/sample-shop-profile.json` — fictional masked Nigeria (NGN) shop profile
- `assets/sample-shop-profile-inr.json` — fictional masked India (INR) shop profile
- `assets/example-request.template.json` — Nigeria request shape for the Python app
- `assets/example-request-inr.template.json` — India request shape (`region: IN`, `currency: INR`)

## Output

After a completed inventory call, expect fields such as `check_in_completed`, `products[]` (including **new goods** the owner introduced), and optional `owner_notes`. New product names are upserted into the SQLite ledger automatically.

After a completed sales call, expect `sales_day_completed`, `estimated_revenue`, `top_sellers[]`, and optional procurement fields.

After a completed reorder-offer call, expect `owner_wants_to_order` and, if true, `items[]` with quantity and vendor detail per item — saved to a `restock_requests` row and the vendor directory.

After a completed vendor-order call, expect `available`, `items[]`, and optional `quoted_amount`/`eta_text` — written back onto the matching `orders` row.

After a completed order-status callback, expect `order_id` and `status_reported` (`placed` / `unavailable` / `delayed`) — the same `orders` row is updated with the callback outcome.

After a completed onboarding call, expect `display_name`, `phone`, `region`, `locale`, both consent flags, and `typical_products[]` — written to `shops` and `products`.

Mask phone numbers in any user-facing summary.

## Scheduling recurring check-ins

This skill places **one call per invocation**. The host scheduler owns recurrence; CALL-E places one call per run.

See [`references/scheduling.md`](./references/scheduling.md) for the cron and Windows Task Scheduler recipes, how to update a schedule without doubling the calls, and how to cancel. Generate entries with `scripts/render_schedule.py` rather than writing them by hand.

For general scheduler-wrapper guidance across other hosts, see [`call-reminder`](../call-reminder/).

## Related project docs

Hackathon plan: `docs/projects/voice-shop-manager/PROJECT_PLAN.md`  
Phase 2 + Phase 3 next steps: `docs/projects/voice-shop-manager/NEXT_STEPS.md`
