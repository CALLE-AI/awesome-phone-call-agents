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
3. `CallVerificationService` calls `calle.calls.create()` (not the SDK's
   `createAndWait()` — see "Key design decisions" below for why), then polls
   with `waitForResult()`. The call request includes:
   - a `task` prompt describing what to confirm on the call, with the
     customer's phone number embedded directly in the text (CALL-E infers
     the target number from the task when `recipients` is omitted — the
     live API rejects a separate `recipient` field despite what the SDK's
     types suggest)
   - a `resultSchema` (JSON Schema) so CALL-E's agent returns a structured
     `outcome` (`confirmed` / `declined` / `address_mismatch` / `unknown`)
     instead of free text we'd have to parse ourselves
4. The order's status becomes `CONFIRMED`, `DECLINED`, `ADDRESS_MISMATCH`,
   or `UNREACHABLE` (fail-safe default if the call never connects).
5. `GET /orders` lists everything for a dashboard; only `CONFIRMED` orders
   should be dispatched (`canDispatch` in the response).

## Setup

### Quick start (safe demo — no API key needed)

```bash
cp .env.example .env
npm install
npm run start:dev
```

This runs in `CALLE_MODE=dry_run` by default. Orders are created and
"confirmed" against a synthetic result — no outbound call is placed and no
CALL-E account is required. You still need to set `DASHBOARD_API_KEY` in
`.env` (already filled in with a dev default in `.env.example`), since
`GET`/`POST /orders` require it.

### Enabling real calls

Only do this with a CALL-E account and phone numbers you're explicitly
authorized to dial — this will place real outbound calls. In `.env`, set:

- `CALLE_MODE=live`
- `CALLE_API_KEY=<your real key>`
- `CALLE_LIVE_CONFIRM=I_UNDERSTAND_THIS_DIALS_REAL_CUSTOMERS`
- `ALLOWED_RECIPIENT_NUMBERS=<comma-separated E.164 numbers>`

Numbers not on the allowlist are blocked before any call is placed.

## Try it

Open **http://localhost:3000** in a browser — that's the dashboard
(`public/index.html`). On first load it'll ask for the dashboard API key
(matches `DASHBOARD_API_KEY` in your `.env`) and remember it in your
browser. Fill in a customer name, phone, address, item, and price, and
submit.
pulsing "calling…" pill while CALL-E is on the phone, then confirmed
(green) / declined or unreachable (red) / address issue (amber). Only
confirmed orders get an enabled "Dispatch" button.

Or hit the API directly:

```bash
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -H "X-API-Key: changeme_dev_only" \
  -d '{
    "customerName": "Test Customer",
    "phoneNumber": "+2340000000000",
    "deliveryAddress": "1 Example Street, Example Town",
    "itemDescription": "Bluetooth headphones",
    "price": 15000
  }'
```

`X-API-Key` must match `DASHBOARD_API_KEY` in your `.env`. In the default
`CALLE_MODE=dry_run` setting, this returns a synthetic `CONFIRMED` result
with no real call placed. Real calls only happen when `CALLE_MODE=live` is
explicitly set — see "Enabling real calls" above.

## A note on the CALL-E SDK integration

`@call-e/calle` ships as an ESM-only package. This project compiles to
CommonJS (standard for NestJS), so a plain `import()` of the SDK gets
downleveled by `tsc` into a `require()` call, which throws
`ERR_REQUIRE_ESM`. `src/call-verification/calle-client.provider.ts` works
around this with a `new Function(...)`-wrapped dynamic import, which is
invisible to `tsc`'s transpiler and survives as a real ESM import at
runtime. This was verified by inspecting the compiled `dist/` output
directly, not assumed.

## Auth & privacy

- All `/orders` routes require an `X-API-Key` header matching
  `DASHBOARD_API_KEY` in `.env`. There's no user system beyond this single
  shared key — fine for an internal demo, not for a public deployment.
- Phone numbers are masked (e.g. `+234****00`) in API responses, dashboard
  rendering, and application logs. The full number is only ever sent
  directly to CALL-E as part of placing the call.
- In live mode, only numbers listed in `ALLOWED_RECIPIENT_NUMBERS` can be
  called — this exists specifically to prevent this demo from being pointed
  at arbitrary real customers without an explicit allowlist.

## What's a stub vs. real

- Order storage is in-memory (`Map`) — swap for Postgres/Mongo for
  production; the `OrdersService` interface is small enough to lift out
  cleanly.
- No webhook receiver for real storefronts yet — `POST /orders` is shaped
  to make that a small mapping exercise, not a redesign.
- The dashboard (`public/index.html`) is plain HTML/CSS/JS served as a
  static file by NestJS itself (no separate frontend build) — good enough
  for the demo video; swap for a real frontend if this goes further.
- Auth is a single shared `X-API-Key` — swap for real per-operator auth
  (JWT, SSO, etc.) before this is exposed beyond a trusted internal team.