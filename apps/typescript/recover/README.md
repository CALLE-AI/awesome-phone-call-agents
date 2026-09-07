# Recover

Catches failed subscription payments the moment they happen and calls the customer
live to get a decision — retry now, update card, or pause — instead of sending an
email that gets ignored.

Built for the CALL-E "Your Code Is Calling" hackathon.

## Why this exists

Up to 40% of subscription churn is involuntary — the customer never chose to
leave, their card just declined. Email-only dunning has a documented failure
mode: unexpected "your payment failed" emails sometimes push a customer who
wasn't paying attention into actively canceling, rather than just fixing their
card. A live, warm phone call opens with reassurance instead of a decision
point, and phone support has the highest first-call resolution rate of any
channel.

## How it works

1. **Trigger**: the dashboard's "Simulate payment failure" button attempts a
   real Stripe **test-mode** charge using Stripe's guaranteed-decline test
   token. This is a genuine `StripeCardError`, not a fabricated event. This
   step does **not** place any call.
2. **Preview**: the exact call task and recipient that *would* be sent to
   CALL-E are computed and shown in the dashboard — the literal text the
   agent would speak from, and the phone number/region/locale it would dial.
   No call has been placed yet.
3. **Confirm or cancel**: a human reviews the preview and explicitly clicks
   either "Confirm & place call" (places the real call) or "Cancel" (discards
   it, subscriber reverts to active, nothing happens). This is the only path
   in the codebase that reaches CALL-E's Calls API — see
   `app/api/calle/place-call/route.ts`.
4. **Live conversation**: once confirmed, CALL-E places the actual outbound
   call and has a two-way conversation with the customer, extracting a
   structured `decision` (`retry_now` / `update_card` / `pause_subscription` /
   `no_answer` / `unknown`) plus supporting `evidence`.
5. **Result**: when the call finishes, CALL-E POSTs a terminal webhook
   (`call.completed`) to `/api/calle/webhook`, which updates the subscriber's
   status and the call log.
6. **Dashboard**: polls every 3s and shows subscriber status + a live call
   feed with each pending preview, decision, and a quote of supporting
   evidence.

## Safety & side effects

- **Side effects**: this app can place a real outbound phone call to a real
  phone number, and can attempt a real (test-mode) Stripe charge. Both are
  visible before/as they happen — there is no hidden background calling.
- **No-call preview by default**: simulating a failure never calls CALL-E by
  itself. A call is only placed after a human sees the literal task text and
  recipient and clicks "Confirm & place call."
- **Cancellation**: a pending call can be discarded any time before
  confirmation via the "Cancel" button (`app/api/calle/cancel-call/route.ts`)
  — the subscriber reverts to `active` and no call is ever placed.
- **Duplicate-call prevention**: a subscriber with a pending or in-progress
  call can't have a second failure/call triggered on top of it (the
  "Simulate payment failure" button disables itself while one is pending).
  Idempotency keys are also passed to CALL-E's Calls API, derived from the
  call log's own id.
- **Credential handling**: all secrets live in `.env.local`, which is
  git-ignored by default and never logged.
- **No secrets or personal data**: the seed route uses a fictional example
  subscriber by default; a real phone number is only ever added locally by
  the developer for their own testing, and `recover.db` (which would contain
  it) is git-ignored.


## Setup

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local`:

- `CALLE_API_KEY` — from https://dashboard.heycall-e.com/account/api-keys
- `STRIPE_SECRET_KEY` — a **test mode** key from https://dashboard.stripe.com/test/apikeys
- `APP_BASE_URL` — CALL-E needs a public URL to deliver the webhook. For local
  dev, run `npx ngrok http 3000` in a separate terminal and paste the
  `https://...ngrok-free.app` URL it gives you.

Then:

```bash
npm run dev
```

Open http://localhost:3000, click **Add test subscriber**, then edit the phone
number in `app/api/subscribers/seed/route.ts` to a real E.164 number you can
answer (e.g. your own phone) before clicking **Simulate payment failure**.
That only runs the Stripe decline and shows you a preview — click
**Confirm & place call** on the pending entry in the call feed to actually
have CALL-E dial the number.

## What's real vs. simulated here

- **Real**: the Stripe decline (test mode, real API call), the CALL-E call
  (real outbound phone call, real conversation, real structured-result
  extraction), the webhook round trip.
- **Simulated for demo purposes**: there's no real subscription billing
  engine behind this — "amount" and "plan" are just fields on a test
  subscriber row. A production version would hook this into Stripe
  subscriptions' `invoice.payment_failed` webhook instead of a
  button-triggered charge.

## Stack

Next.js (App Router) + TypeScript + Tailwind, `better-sqlite3` for local
storage, `stripe` and `@call-e/calle` SDKs.
