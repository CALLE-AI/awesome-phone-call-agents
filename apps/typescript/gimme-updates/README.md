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
- `CALLE_DRY_RUN` — **defaults to `true`**. See "Dry-run behavior" below.

Then:
```bash
npm run db:generate
npm run db:migrate
npm run dev
```

Visit `localhost:3000` to try the public signup flow, or `npm run db:seed` for a single local demo user.

## Dry-run behavior (important)

`CALLE_DRY_RUN=true` (the default) means **no real phone call is placed**. The app logs the exact task text and `resultSchema` it would have sent to CALL-E, and returns a fake but realistic structured result so the rest of the pipeline (decision storage, reminder scheduling, dashboard display) can be tested safely without consuming CALL-E call credits.

Set `CALLE_DRY_RUN=false` to place real calls. We recommend testing with dry-run on first, then flipping it off for a single deliberate real-call test, since CALL-E call credits are limited.

## Side effects

- Real calls (when `CALLE_DRY_RUN=false`) place an actual outbound phone call to the phone number provided at signup.
- A basic rate-limit guard restricts each user to one real digest call, to avoid unintentional credit usage from repeated testing or demo clicks. Dry-run calls are not limited.
- Reminder calls (via the cron route) place a second real call when a scheduled reminder comes due, if not in dry-run mode.

## Cancellation

There's no in-call cancellation flow yet — a scheduled reminder can be prevented from firing by deleting its row from the `reminders` table before its `remindAt` time passes. This is a known gap for a production version (see "What's next").

## What's next

- Real Gmail integration (read-only, consent-based) replacing the seeded inbox
- A live "follow-up" call type that actually contacts the sender/company when a user requests it (currently captured as a decision but not yet dispatched)
- A caregiver-facing view for setting up and monitoring calls on someone else's behalf
- User-facing reminder cancellation

## Tech stack

Next.js (App Router), TypeScript, Drizzle ORM + SQLite, CALL-E SDK, OpenRouter, Tailwind CSS.