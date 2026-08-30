# DispatchCheck

Pre-delivery order confirmation caller for cash-on-delivery e-commerce in
Nigeria, Ghana, and beyond — built on [CALL-E](https://www.heycall-e.com).

**The problem:** COD sellers dispatch a rider, then find out the customer is
unreachable, changed their mind, or gave a bad address — the seller eats the
cost of the wasted trip.

**What DispatchCheck does:** before a rider leaves, CALL-E places a real
phone call to the customer, confirms they still want the order and that the
address is correct, and reports back a structured result. Only confirmed
orders are marked dispatchable.

## How it works

1. `POST /orders` — simulates a webhook from a storefront (Shopify, WhatsApp
   checkout, a custom cart, etc). Payload: customer name, phone, address,
   item, price.
2. `OrdersService` creates the order in `PENDING_CALL`, then immediately
   calls `CallVerificationService.confirmOrder()`.
3. `CallVerificationService` calls `calle.calls.createAndWait()` with:
   - a `task` prompt describing what to confirm on the call
   - a `recipient` (phone + name)
   - a `resultSchema` (JSON Schema) so CALL-E's agent returns a structured
     `outcome` (`confirmed` / `declined` / `address_mismatch`) instead of
     free text we'd have to parse ourselves
4. The order's status becomes `CONFIRMED`, `DECLINED`, `ADDRESS_MISMATCH`,
   or `UNREACHABLE` (fail-safe default if the call never connects).
5. `GET /orders` lists everything for a dashboard; only `CONFIRMED` orders
   should be dispatched (`canDispatch` in the response).

## Setup

```bash
cp .env.example .env
# edit .env and add your real CALLE_API_KEY (from the CALL-E install guide)

npm install
npm run build
npm start
```

## Try it

Open **http://localhost:3000** in a browser — that's the dashboard
(`public/index.html`). Fill in a customer name, phone, address, item, and
price, and submit. The card shows the live status of every order: a
pulsing "calling…" pill while CALL-E is on the phone, then confirmed
(green) / declined or unreachable (red) / address issue (amber). Only
confirmed orders get an enabled "Dispatch" button.

Or hit the API directly:

```bash
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customerName": "Ada Obi",
    "phoneNumber": "+2348012345678",
    "deliveryAddress": "12 Allen Avenue, Ikeja, Lagos",
    "itemDescription": "Bluetooth headphones",
    "price": 15000
  }'
```

With a real API key, this places an actual outbound call to that number.

## A note on the CALL-E SDK integration

`@call-e/calle` ships as an ESM-only package. This project compiles to
CommonJS (standard for NestJS), so a plain `import()` of the SDK gets
downleveled by `tsc` into a `require()` call, which throws
`ERR_REQUIRE_ESM`. `src/call-verification/calle-client.provider.ts` works
around this with a `new Function(...)`-wrapped dynamic import, which is
invisible to `tsc`'s transpiler and survives as a real ESM import at
runtime. This was verified by inspecting the compiled `dist/` output
directly, not assumed.

## What's a stub vs. real

- Order storage is in-memory (`Map`) — swap for Postgres/Mongo for
  production; the `OrdersService` interface is small enough to lift out
  cleanly.
- No webhook receiver for real storefronts yet — `POST /orders` is shaped
  to make that a small mapping exercise, not a redesign.
- The dashboard (`public/index.html`) is plain HTML/CSS/JS served as a
  static file by NestJS itself (no separate frontend build) — good enough
  for the demo video; swap for a real frontend if this goes further.
