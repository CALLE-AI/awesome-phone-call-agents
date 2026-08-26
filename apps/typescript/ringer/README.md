# Ringer — the phone calls you hate, handled

A consumer web app that turns dreaded phone tasks into structured, consent-first
CALL-E workflows. Describe a call in plain English — *negotiate my internet
bill, cancel my gym membership, book a dentist appointment, chase a stuck
refund, get quotes from five auto shops* — and Ringer builds a precise CALL-E
task with a strict result schema, places the call, and returns a clear outcome:
the new price, the confirmation number, the answer — with completion
confidence, quoted evidence, and the full transcript.

- **Live demo:** https://ringer-steel.vercel.app
- **Source:** https://github.com/DevJustinTech/ringer
- **Language:** TypeScript (React + Vite front end, Vercel serverless functions)
- **CALL-E surface used:** server SDK (`@call-e/calle`), REST API
  (`/v1/calls`, `/v1/calls/{id}`, `/v1/calls/{id}/events`), current unsigned
  terminal webhooks

## Why not just use the CALL-E assistant?

CALL-E's assistant is a horizontal, free-form chat — one call at a time, you
supply the instruction and read the conversation back. Ringer is a vertical
product on the same API that adds the layer the assistant leaves to you:

- **Many calls, one decision** — Quote Shootout calls several businesses in
  parallel and returns a *ranked comparison with total savings*, not a single
  chat.
- **Outcomes as data, not a transcript** — typed, comparable fields
  (`new_amount`, `monthly_savings`, `cheapest_price`…) that drive an impact
  dashboard, `.ics` export, and savings tracking.
- **Won't overstate** — outcomes are tagged *evidence-backed* / *needs review*
  and batch results name their denominator ("2 quoted of 3 called · 1 not
  reached — not counted").
- **Expert, guard-railed scripts + follow-through** — tuned negotiation tactics
  and decision limits, a fixed AI disclosure, and durable recurring
  re-negotiation.

In short: the assistant places a call; Ringer turns calls into comparable,
trustworthy outcomes — especially across many businesses at once.

## Why it's useful for AI-agent phone-call workflows

- **Playbook engine** — six task playbooks each compile user input into a tuned
  natural-language `task` plus a strict JSON `result_schema`, so every call
  returns typed, renderable data instead of prose.
- **Batch comparison ("Quote Shootout")** — one task, many recipients:
  `recipient_result_schema` extracts a per-business quote and a call-level
  `result_schema` captures the aggregate (cheapest business, potential
  savings), demonstrating CALL-E's dual-schema pattern end to end.
- **Human-in-the-loop decision authority** — an "Ask me first" mode: in the
  bundled simulator the agent pauses when an offer lands and waits for a
  tap-to-decide (accept / push for better); in live mode the same intent
  compiles into explicit DECISION AUTHORITY guardrails in the task text (the
  agent may never commit without the user, or may auto-accept only under a
  user-set ceiling).
- **Follow-up lifecycle** — voicemail/hard-no outcomes offer an
  escalation-hardened retry or a scheduled follow-up; successful negotiations
  can arm a "Rate Watch" that queues a prefilled renegotiation before the promo
  expires.

## Dry-run / preview behavior (default)

**Demo Mode is the default and requires no CALL-E account, key, or credits.**
A client-side simulator reproduces the CALL-E object model exactly — statuses
(`queued → in_progress → completed`), streaming transcript turns, developer
events, structured results, `completion_confidence`, and `evidence` — so the
entire app can be explored with **zero real-world side effects**. Live calling
is a deliberate, opt-in switch in Settings. Before any live call, the exact
task instruction and the schema fields to be extracted are shown for review.

## Setup

```bash
pnpm install
pnpm dev            # Demo Mode works immediately at http://localhost:5173
```

Full stack (serverless functions + live calling):

```bash
pnpm dlx vercel dev
# In the app: Settings → Live → paste your CALL-E API key (BYOK)
# Or: cp .env.example .env and set CALLE_API_KEY server-side
```

## Credential handling

- **BYOK:** the user's CALL-E API key (and any shared-key access secret) is kept
  only in the browser's **`sessionStorage`** — isolated from the durable,
  cross-tab settings in `localStorage`, and cleared when the tab/session closes —
  and forwarded per-request to the app's own serverless proxy. A **"Forget key"**
  control wipes it on demand. It is never persisted server-side and never sent to
  any third party.
- Alternatively an operator sets `CALLE_API_KEY` as a server environment
  variable; the browser never sees it. `/api/health` only reports whether a
  server key exists.
- **The shared server key is access-controlled.** Any endpoint that would spend
  it (`/api/calls`, `/api/call*`, `/api/schedule`) requires a matching
  `CALLE_APP_SECRET` (sent as `x-ringer-app-secret`), so strangers can't spend
  the operator's account on a public deployment. It **fails closed**: if
  `CALLE_API_KEY` is set without `CALLE_APP_SECRET`, the shared key is locked and
  callers must use their own key (BYOK). BYOK requests need no secret — they
  spend the caller's own key. The scheduler cron dials with the server key, so
  when the scheduler is armed (KV + server key) it **requires `CRON_SECRET`** and
  a matching Bearer token and **fails closed** if the secret is unset — the
  dialer is never publicly triggerable.
- Optional `CALLE_WEBHOOK_URL` opts calls into current unsigned terminal-event
  delivery. `/api/webhook` requires `application/json`, validates that the
  `CALL-E-Event-Id` header matches the bounded body event ID, accepts only the
  documented terminal event types, and logs only bounded event/call IDs. This
  consistency check is not sender authentication, so the endpoint performs no
  business side effect and the live UI remains polling-based. A production
  extension must durably deduplicate event IDs and reconcile through an
  authenticated Calls API read before trusting a notification. Current CALL-E
  deliveries do not include a webhook secret or signature headers; see the
  [webhook guide](https://docs.heycall-e.com/#/webhooks).
- A caller-supplied API base URL is honored only for the official
  `*.heycall-e.com` host (or loopback) and only alongside a BYOK key — the
  operator's server key is never redirected to a client-chosen host.
- No secrets are committed; see `.env.example`.

## Side effects

- **Live mode places real outbound phone calls** through CALL-E. Each call
  requires an explicit per-call consent checkbox ("I'm authorized to place
  this call and the number is correct"). Only strict **E.164** numbers are
  submitted; an explicit `+`-number is never repaired, and when a country code
  is inferred from the selected region it is **shown and flagged for
  confirmation** ("assuming United States — type + and the country code to
  override"), never applied silently.
- Every call opens with a fixed **AI disclosure** — the agent states at the
  start that it is an automated assistant calling on the user's behalf. The
  disclosure is not caller-editable.
- **By default**, scheduled follow-ups and rate watches are **in-browser
  reminders** that never place a call on their own — a due item surfaces a
  banner and needs an explicit "Run now" tap.
- **When the operator enables the durable scheduler** (Vercel KV + server key),
  a scheduled or recurring call is placed **automatically at its due time** by a
  cron using the server key. Each such job is listed and **cancelable from the
  drawer up until it fires** (see Cancellation).
- **Scheduling a call is itself idempotent.** A job's id is derived from a
  caller-supplied `Idempotency-Key` (or, absent one, the scheduling content keyed
  by due time), and the store creates it **atomically (`SET … NX`)**. So a lost
  `POST /api/schedule` response followed by a retry maps to the **same** job
  instead of scheduling a duplicate — and since the cron uses that stable id as
  the provider idempotency key, a retried schedule can never dial the call twice.
- **Ambiguous outcomes are never faked into a verdict.** A transient failure
  (network, timeout, 5xx, throttle) keeps the job `pending` for a bounded retry
  under the same idempotency key. If the retry budget is exhausted while the
  outcome is still unknown, the job is parked as **`unresolved` ("Needs check")
  for reconciliation** — it is *not* converted into a definitive `failed`. Only a
  definitive 4xx rejection marks a job `failed`. **To reconcile:** the stable
  idempotency key (the job id) identifies the call in the CALL-E dashboard —
  confirm whether it was placed, then dismiss the job from the drawer. It stays
  flagged until an operator resolves it, so an ambiguous result never silently
  reads as success or failure.
- Every create-call request carries a **content-bound idempotency key** derived
  from the phone, task, and result schema, so an accidental retry dedups and an
  edited request can never alias a prior call under the same key.

## Cancellation / rollback

- Scheduled follow-up calls and rate watches can be cancelled or removed at
  any time from the in-app drawer (single tap), before anything is placed —
  including durable server-scheduled jobs, which are deleted from the store
  (`DELETE /api/schedule`) so the cron never fires them. Cancellation and the
  cron's dispatch take a **per-job atomic lock** (`SET … NX`) and re-read the
  job's status inside it, so the two can't race: if a call is already being
  placed the cancel is refused with `409` rather than tearing down a live dial;
  otherwise the job is removed before the cron can claim it.
- The in-progress view offers Cancel, which stops the app's polling and
  discards the workflow client-side. Note: once a live CALL-E call task has
  been accepted by the provider, the call itself runs to completion on the
  provider side — Ringer surfaces this honestly rather than pretending to
  tear down an in-flight phone call.

## Tests / verification

```bash
pnpm verify:all   # production build + serverless typecheck
                  # + 98 runtime logic checks (lifecycle, schemas, HITL
                  #   checkpoint/branching, voicemail/escalation, E.164,
                  #   bill parsing, .ics generation)
                  # + server-render smoke test of 28 UI components
```

Everything runs against the built-in simulator, so **no CALL-E credentials or
real calls are needed for verification**. Live verification is opt-in: switch
Settings → Live with your own key and place a single call.

## Safety notes

- Consent-first: no call without the explicit checkbox; numbers validated to
  E.164; caller identity ("calling on behalf of …") is stated in the task.
- Task prompts instruct the agent to never invent account details, PINs, card
  numbers, or personal data, and to say so when asked for something it was
  not given.
- All sample and demo phone numbers are fictional (`+1 415 555 01xx` range) or
  masked in the UI; the built-in business directory labels fictional demo
  listings separately from public corporate support lines.
- Decision authority is explicit: the agent either may not commit at all, or
  only below a user-set dollar ceiling.

## Compatibility

- Node ≥ 20, pnpm ≥ 9. Runs as a static Vite front end plus Vercel-style
  serverless functions; the front end can be hosted anywhere that can proxy
  the four small API routes.
- Uses the published `@call-e/calle` SDK and the documented public REST
  endpoints only; no private or unpublished packages.
