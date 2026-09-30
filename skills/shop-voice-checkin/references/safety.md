# Safety — shop voice check-in calls

## Intent and consent

- Place an outbound call only when the **shop owner has explicitly agreed** to regular business check-ins from this service.
- Do not cold-call retailers, suppliers, or customers for lead generation.
- Default runnable app mode is **preview** (no CALL-E network call).

## Non-financial boundaries

This skill collects **operational shop data**, not regulated financial advice.

- No loan offers, credit decisions, insurance sales, or investment advice on the call.
- No promises about profit, savings, or business outcomes.
- If the owner asks for formal accounting or tax help, suggest they speak with a qualified human professional.
- No emergency handling — the agent is not a security or medical service.
- No bank-account collection or credit scoring on any call. Offline weekly insights may later inform a bank conversation; that stays out of the voice path.
- **Phase 3 payouts:** the agent may confirm a payment amount by voice, but must **never** collect account numbers, BVN/NUBAN, PINs, OTPs, or USSD codes on the call. Payee tokens are linked offline.

## Phone numbers and data

- Use **E.164** format for live runs.
- Set explicit CALL-E **region** and **locale** in the request — do not infer routing from the number prefix.
- Mask phone numbers in logs, previews, demo video, and git.
- Do not commit API keys, live request files, or call results with full transcripts.
- Never invent a vendor or owner phone number. Leave vendor `phone_e164` null until the owner provides it.

## Side effects

- Live execution creates a **real phone call** and consumes CALL-E credits.
- One shop owner per call task unless the user explicitly authorizes batch outreach.
- Morning inventory and evening sales are **separate call tasks** with separate idempotency keys.

## New goods on inventory calls

- Owners may introduce products that were not in the prior inventory list.
- Capture each new name with quantity and unit; the ledger upserts a new `products` row automatically.
- Do not refuse unknown product names. Do not require a pre-registered catalog.

## Phase 2 — multi-party procurement (owner ↔ agent ↔ vendor)

When restock workflows are enabled (issues P2–P5):

1. **Owner must say yes** before any vendor is contacted. Low stock alone never auto-orders.
2. **Per-vendor authorization** — the owner must authorize contacting that specific vendor (or confirm a saved vendor by name).
3. **Separate consent for status callbacks** — calling the owner back with ETA/status needs explicit opt-in (can be part of the restock yes).
4. **Preview by default** — live vendor dials and owner callbacks require the same dual flags as owner check-ins (`--execute --confirm-recipient-opt-in`) plus request-level consent fields. Vendor dials also require `--confirm-vendor-order` and `vendor_contact_authorized` — never synthesize vendor consent from the shop owner's check-in opt-in.
5. **Live console is advisory** — after the first authorized check-in, the web console plans reorder / vendor / status legs but does not dial them until `POST /api/checkins/approve` with explicit per-recipient authorization. `SHOPVOICE_DEMO=1` may auto-rehearse with fixtures only.
5. **No recurring auto-orders** — each restock request is one-shot unless the host scheduler creates a new confirmed job with a cancel path.
6. Vendor and callback calls are **separate** from inventory/sales check-ins; do not combine them into one CALL-E task.

## Phase 2 — new-shop onboarding (issue P6)

1. **Owner-initiated only** — onboarding runs because the owner asked to sign up or pre-agreed to an intake call. Never a cold outreach call to a number found some other way.
2. **Two explicit consents** — storing the collected profile, and receiving future check-in calls. Both are separate yes/no answers, not implied by completing the call.
3. **No inference** — display name, phone, region, locale, and currency are asked for explicitly. Never derive region/locale from a phone number prefix.
4. **Returning owner** — if a shop already exists for the given phone, offer a short confirm ("still X, same number?") instead of the full intake script.
5. **Privacy-minimized receipt** — the call receipt records that onboarding happened, not a full transcript of shop finances.

## Phase 3 — vendor payouts (owner pay-yes → payment adapter)

After a vendor order has a known amount (Phase 2 P4), paying the vendor is a **separate** side effect:

1. **Second consent** — owner must approve paying **this exact amount** for a known `order_id`. Order-yes is not pay-yes.
2. **No secrets on the call** — never ask for bank account numbers, BVN, NUBAN, PIN, OTP, or USSD. Offline `payee_ref` linking only.
3. **Preview by default** — fake/local adapter dry-runs unless dual payout flags are set (`execute` + `confirm_owner_payment` in the app).
4. **One transfer per idempotency key** — retries must not double-pay.
5. **Caps** — respect per-intent max amount; refuse oversized payouts.
6. Status callbacks may report `pending_pay` / `paid` / `failed` after the adapter runs; they still must not coach loans or credit.

Result schema: `references/result-schema-payment-consent.json`.

## Idempotency

Derive keys from shop identity and call type, not from retry attempt number:

```text
shopvoice-{shop_id}-inventory-{YYYY-MM-DD}
shopvoice-{shop_id}-sales-{YYYY-MM-DD}
shopvoice-{shop_id}-vendor_order-{request_id}
shopvoice-{shop_id}-order_status-{request_id}
shopvoice-{shop_id}-onboarding-{YYYY-MM-DD}
shopvoice-{shop_id}-vendor_pay-{intent_id}
```

Do not place a duplicate live call for the same key unless the user explicitly requests a retry after a failed attempt.

## Cancellation

- Before execution: use preview mode; omit live flags.
- For recurring check-ins scheduled via a host cron or Task Scheduler: deleting or disabling that job stops future calls. Clearing `recipient_consented` alone does **not** — the scheduler never reads it. See [`scheduling.md`](./scheduling.md#cancellation).
- Cancel a draft restock request by setting status to `cancelled` before a vendor dial; document the cancel path in the scheduler recipe when Phase 2 goes live.
- After CALL-E accepts a task, use dashboard controls if cancel is available before the dial completes.

## Platform coverage

Confirm outbound regions and locales against CALL-E [supported regions and languages](https://github.com/CALLE-AI/call-e-integrations#-supported-regions-and-languages) before live runs. Nigeria (`NG`) and India (`IN`) are supported for hackathon pilots.

## Privacy

- Structured results may include approximate revenue and supplier names — treat as business-confidential.
- Share summaries only with the authorized shop owner or their designated operator.
- Do not reuse one retailer's data to advise another without explicit aggregation and consent (post-MVP).
