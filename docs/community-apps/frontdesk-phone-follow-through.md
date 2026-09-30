# FrontDesk Phone Follow-Through

FrontDesk is a multi-tenant AI front desk for WhatsApp, Messenger and Instagram:
a business loads its catalogue, hours and policies, and an AI assistant answers
customers, takes orders and bookings, and hands off to a shared human inbox.
Phone Follow-Through adds the step chat cannot do: when a record needs closing,
the AI **picks up the phone** through CALL-E and writes the structured result
back to the same order, booking and conversation. This is an external experimental
integration reference, not a production-safety certification.

- Repository: [https://github.com/TayseerLaz/frontdesk-core](https://github.com/TayseerLaz/frontdesk-core)

## The phone-work problem

In Lebanon, the Gulf and much of South-East Asia, most chat-commerce orders are
paid **cash on delivery**. Fake, duplicated or forgotten orders turn into failed
deliveries, so shops employ staff to phone-confirm every order by hand before it
is prepared. That is repetitive, slow at peak, and skipped when busy — exactly
when it matters most.

## What the app does with CALL-E

Three triggers share one pipeline (`apps/api/src/lib/phone-tasks.ts`):

| Trigger | Call goal | Write-back |
| --- | --- | --- |
| Cash-on-delivery order — a **Confirm by phone** button on the Orders page, or automatic N minutes after the order lands | Read back the real cart rows and total, confirm the delivery address, record requested changes | order → `confirmed` / `cancelled`, or `needs_review` for a human |
| Booking | Ask whether the customer can still attend; capture a requested new time without promising it | booking → `confirmed` / `cancelled`, or `needs_review` |
| Custom goal typed by an operator for a conversation | Whatever the team asks, grounded in the business name and policies | inbox note only, no record mutation |

The spoken brief is compiled from the tenant's **own data** — order rows,
address field, delivery policy, business name, configured language — never from
an LLM's summary of the chat. The `result_schema` sent to CALL-E is built per
kind with happy-first enums (`disposition`, `confirmed`, `address_correct`,
`requested_changes`, …). Every completed call leaves a note in the customer's
inbox thread with the summary, confidence and extracted fields, so the
conversation history stays the single source of truth for the operator.

## CALL-E integration method

- SDK: `@call-e/calle` 0.7.0, imported in exactly one file,
  `apps/api/src/lib/calle.ts`. Calls are created with `client.calls.create`
  (`recipients[]`, `resultSchema`, `recipientResultSchema`, `metadata`,
  optional `webhookUrl`) and an `Idempotency-Key`; state is read with
  `client.calls.get`.
- Results arrive two ways that converge on one compare-and-set: the public
  webhook receiver `POST /api/v1/calle/webhook/:orgId?token=…` (deduplicated on
  `CALL-E-Event-Id`, re-reads the call from the API rather than trusting the
  body) and a 30-second poll in the API process for deployments without a public
  URL.
- The API key lives only in the backend environment; the browser talks to the
  platform's own JWT-protected routes under `/api/v1/phone-tasks`.

## Setup

Requirements: Node.js 20+, pnpm 9, PostgreSQL 16, Redis 7.

```bash
git clone https://github.com/TayseerLaz/frontdesk-core.git
cd frontdesk-core
cp .env.example .env        # fill DATABASE_URL, REDIS_URL, both JWT secrets, BRAND_*, INITIAL_ADMIN_*
docker compose up -d        # or point at a local Postgres + Redis
pnpm install
pnpm bootstrap              # migrate + create the first admin
pnpm dev                    # portal on http://localhost:3000/app, API on :4000
```

Open **Orders**, create or receive a cash-on-delivery order, click **Confirm by
phone**, then watch **Phone tasks**. The repository README documents every
environment variable.

## Safe testing path with no calls

`CALLE_DRY_RUN=true` is the committed default. Every code path runs — task row,
idempotency key, status machine, cart flip, inbox note, notification, outbound
webhook — but nothing is dialed: each task "rings" for 15 seconds and then
completes with a synthetic happy-path result derived from its own result
schema, clearly labelled *DRY RUN* in the UI, the note and the summary.

To go live: set `CALLE_API_KEY`, `CALLE_DRY_RUN=false`, and keep
`CALLE_LIVE_OVERRIDE_PHONE=+<your verified number>` so every live call is
redirected to one number you control. The override is enforced in code, not
documentation.

## Call side effects

A live call rings a real phone, spends one CALL-E call credit, stores the
summary, structured result and transcript on the tenant's `phone_tasks` row
(protected by Postgres row-level security), posts an internal note in the
customer's inbox thread, raises a bell notification, and may change an order or
booking status. The external implementation uses task completion, confidence ≥ 0.7
and heuristic result rules. In particular, its COD rule can cancel an order when
`confirmed = no` even if the disposition is `changed`. These rules are not proof of
customer intent or a guarantee that every ambiguous answer reaches `needs_review`;
operators must assess them before enabling real order or booking mutations.

## Cancellation and duplicate-call protections

- Tasks are one-shot; there are no hidden retries. The auto-confirm scanner
  never creates a second task for an order that already has one.
- Auto-confirm is a per-tenant switch (off by default) with a delay and a daily
  cap; turning it off stops new calls immediately.
- Contacts who opted out or are blocked are refused before a row exists, as are
  numbers outside CALL-E's supported countries.
- Each task persists an attempt-scoped `Idempotency-Key` before the first request.
  Protection depends on reusing that key and the provider's dedupe behavior; a
  new attempt has a new key. This is not crash-proof recovery or permanent dedupe.
- Disabling auto-confirm stops future tasks, not calls already accepted by the
  provider. Closing the page does not hang up a call. Reconcile unknown outcomes
  before another attempt, and do not report cancellation without provider confirmation.

## Scope notes

Not for medical, legal, financial, collections or unsolicited marketing calls.
The caller discloses which business it represents, reads back only facts from
the order, and defers anything it does not know to the team.
