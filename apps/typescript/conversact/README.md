# Conversact

AI phone calls as the storefront.

Conversact is a consent-first CALL-E conversational-commerce reference that turns one authorized phone conversation into structured purchase intent. It never treats the model or phone-call result as commercial truth.

> **CALL-E expresses intent. The commerce backend establishes commercial truth.**

## What it demonstrates

```text
Explicit consent → CALL-E call → structured purchase intent → result validation
                                                        → independent commerce quote → synthetic checkout handoff
```

The small local catalog is intentionally fictional. The public app has no Jalolink, Telegram, Paystack, customer data, real transcript, or real payment dependency.

## Quick start

```bash
cd apps/typescript/conversact
npm install
npm test
npm run simulate
```

`simulate` is the main reviewer path. It loads a deterministic fixture, validates the CALL-E-shaped result, quotes against the local catalog, and makes a synthetic checkout handoff. It makes no network request, telephone call, or payment.

Use another fixture to inspect a refusal path:

```bash
npm run simulate -- --fixture unavailable-product
npm run simulate -- --fixture ambiguous-result
```

## Preview

```bash
npm run preview
```

Preview needs no credentials. It prints a masked recipient, bounded task, result schema, idempotency identity, and side-effect warning. It cannot place a call.

## Live CALL-E mode

Live mode is optional and requires all of the following:

```bash
CONVERSACT_LIVE_CALLS=true CALLE_API_KEY=... npm run live -- \
  --phone +14155550100 --session cv_example_001 --confirm-place-real-call
```

The operator must have explicit authorization from the recipient for this one conversational-checkout call. The app requires strict E.164 and never infers a country code. It masks the number in progress output, rejects an untrusted credential host, and sends the stable `conversact:<session>:call:v1` idempotency key to CALL-E.

There is no default live destination and no scheduler. Once CALL-E accepts a call it may not be cancellable; closing the process does not guarantee a submitted call stops. After a timeout, lost connection, or other ambiguous create result, Conversact records `CALL_AMBIGUOUS` and does not automatically redial.

`.env.example` contains names only:

```env
CALLE_API_KEY=
CONVERSACT_LIVE_CALLS=false
```

## Commerce and payment boundaries

CALL-E may return product IDs, quantities, delivery preference, and a confirmation signal. It has no authority over prices, stock, totals, payment, order creation, receipt issuance, or inventory mutation. `DemoCommerce` independently checks product existence, active status, positive integer quantity, and stock; it then reads catalog prices and calculates the total.

The included `DemoPayment` creates a clearly synthetic `demo_ready` checkout URL only after a validated quote. A checkout URL is not a payment confirmation and this app never prints a payment receipt.

## Side effects

| Mode | Places a call | Creates a real payment |
| --- | ---: | ---: |
| Preview | No | No |
| Simulation | No | No |
| Live CALL-E | Yes, one requested attempt | No |
| Jalolink deployment case study | Outside this repository | Outside this repository |

See [side effects](docs/side-effects.md), [safety](docs/safety.md), and [architecture](docs/architecture.md) for the exact boundary.

## Privacy and sensitive topics

The demo stores only session state, masked display output, structured outcome, quote, and synthetic handoff. It does not persist transcripts by default. Never put an API key, full real phone number, payment detail, or private transcript in fixtures or logs.

This is a bounded commerce workflow. The task refuses to provide medical, legal, financial, emergency, or personal-safety advice.

## Jalolink case study

Conversact was extracted from work on Jalolink. The private deployment conceptually uses Telegram for authorization, CALL-E for the ordering conversation, Jalolink for authoritative commerce validation, and Paystack test-mode reconciliation. This reproducible public app replaces those private boundaries with deterministic local adapters. See [the case study](docs/jalolink-case-study.md).

During hackathon development, CALL-E regional risk controls rejected direct Nigerian `+234` outbound requests. The provider-approved US hotline was used only for integration validation and is not hard-coded here; this app does not assume unsupported destinations. See [platform feedback](docs/platform-feedback.md).

## Validation

```bash
npm test
npm run typecheck
```
