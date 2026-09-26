# Gimme Updates

A daily phone call that reads your important emails aloud and captures spoken decisions — built for people who are blind, elderly, or who simply don't want to navigate a screen-based inbox.

## What it does

Gimme Updates calls a user once a day (or on demand) and walks through their prioritized emails one at a time, in plain language. After each email, it asks what the user wants to do: nothing, a reminder, or a follow-up — and waits for a spoken answer before moving on. Reminders are stored and automatically trigger a follow-up call from CALL-E when they come due, closing the loop without any further action from the user.

For this submission, the "inbox" is a seeded set of sample emails (a bill, a loan reminder, a government notice, and a couple of promotional emails) rather than a live Gmail connection — this keeps the demo reliable to run, while the classification and CALL-E integration work identically against a real inbox. Real Gmail integration is on the roadmap (see "What's next" below).

## How it uses CALL-E

The core of the app is a single CALL-E task (`lib/calle.ts`, `runDigestCall`) that:
- Receives a prioritized list of the day's emails
- Asks CALL-E to read through them one at a time and capture a spoken decision for each (skip / remind / follow up)
- Defines a `resultSchema` requiring `emailId` and `action` per decision, with optional `reminderDate` and `followupInstruction` fields

A second, lighter CALL-E task places reminder callback calls when a scheduled reminder comes due (triggered via `app/api/cron/route.ts`).

## Setup

```bash
cd apps/typescript/gimme-updates
npm install
cp .env.example .env
```

Fill in `.env`:
- `DATABASE_URL` — SQLite file path, e.g. `./dev.db`
- `OPENROUTER_API_KEY` — used for email classification (category, urgency, summary, due date) via OpenRouter
- `CALLE_API_KEY` — your CALL-E API key
- `ALLOW_REAL_CALLS` — **defaults to `false`**. Required safety switch for any public deployment. See below.
- `CALLE_DRY_RUN` — **defaults to `true`**. Even when set to `false`, real calls are still blocked unless `ALLOW_REAL_CALLS=true`, the request presents `OPERATOR_SECRET`, and the destination is in `ALLOWED_RECIPIENTS`.
- `OPERATOR_SECRET` — shared secret for the digest real-call path, cron, reminder reads, email fetch, and schedule updates. Send `Authorization: Bearer <secret>` or a JSON `operatorSecret` field.
- `ALLOWED_RECIPIENTS` — comma-separated ASCII E.164 numbers. A real call is placed only when the target is in this list.

Then:
```bash
npm run db:generate
npm run db:migrate
npm run dev
```

Visit `localhost:3000` to try the public signup flow, or `npm run db:seed` for a single local demo user.

## Public deployment safety (required)

**Any publicly reachable deployment must keep `ALLOW_REAL_CALLS` unset or `false`.** This is the required safety posture for this demo: the signup and digest routes accept any E.164 number with no proof that the submitter owns it, so a public instance must not be able to place real CALL-E calls.

When `ALLOW_REAL_CALLS` is not exactly the string `true`, the app **forces dry-run/fake CALL-E behavior** regardless of `CALLE_DRY_RUN`. Setting `CALLE_DRY_RUN=false` alone cannot enable real calling. The digest and cron routes also reject a real-call attempt that does not present `OPERATOR_SECRET` (`401`). A valid secret still cannot call a number that is not ASCII E.164 and listed in `ALLOWED_RECIPIENTS` (`403`, and cron skips that recipient). Missing either check never places a call.

To place real calls, an operator must set all of:

```bash
ALLOW_REAL_CALLS=true
CALLE_DRY_RUN=false
OPERATOR_SECRET=choose-a-long-random-secret
ALLOWED_RECIPIENTS=+14155550100
```

Send the secret on each real-call or private-record request:

```bash
curl -H "Authorization: Bearer $OPERATOR_SECRET" https://<host>/api/cron
```

Do this only on a private/operator-controlled environment, and only for numbers you are authorized to call.

Reminders created while fake/dry-run mode is active are stored with `isSimulated=true`. Only a verified real digest call stores `isSimulated=false`. Cron will skip simulated rows and never promote them to a real call if you later flip the flags. Reminders that existed before that distinction (migration 0005 defaulted `is_simulated` to false) are reset to simulated and `unresolved` by migration 0006. Failed or ambiguous CALL-E results are marked `unresolved` (not left `pending`) so the next cron tick cannot silently redial.

Phone numbers in logs and API responses are masked to the last 4 digits (for example `+91XXXXXX1234`). Full task text, CALL-E result payloads, and transcripts are not returned to the client.

## Dry-run behavior

`CALLE_DRY_RUN` defaults to `true`. Combined with `ALLOW_REAL_CALLS` (above), that means **no real phone call is placed** unless an operator has explicitly enabled real calling. In fake mode the app still runs the rest of the pipeline (decision storage, reminder scheduling, dashboard display) against a realistic structured result, without consuming CALL-E call credits.

We recommend testing with fake mode on first, then enabling real calls only for a single deliberate test, since CALL-E call credits are limited.

## Side effects

- Real calls (only when `ALLOW_REAL_CALLS=true`, `CALLE_DRY_RUN=false`, the request includes `OPERATOR_SECRET`, and the number is in `ALLOWED_RECIPIENTS`) place an actual outbound phone call to that allowlisted number.
- A basic rate-limit guard restricts each user to one real digest call, to avoid unintentional credit usage from repeated testing or demo clicks. Dry-run calls are not limited.
- Reminder calls (via the cron route) place a second real call when a scheduled **non-simulated** reminder comes due, if real calling is enabled. Simulated reminders are skipped.

## Cancellation

There's no in-call cancellation flow yet — a scheduled reminder can be prevented from firing by deleting its row from the `reminders` table before its `remindAt` time passes. This is a known gap for a production version (see "What's next").

## What's next

- Real Gmail integration (read-only, consent-based) replacing the seeded inbox
- A live "follow-up" call type that actually contacts the sender/company when a user requests it (currently captured as a decision but not yet dispatched)
- A caregiver-facing view for setting up and monitoring calls on someone else's behalf
- User-facing reminder cancellation

## Tech stack

Next.js (App Router), TypeScript, Drizzle ORM + SQLite, CALL-E SDK, OpenRouter, Tailwind CSS.