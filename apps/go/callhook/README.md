# callhook

callhook is the voice channel as an API: a business system fires a webhook,
and callhook places an intelligent [CALL-E](https://heycall-e.com) phone call
with the customer's context prefetched, then POSTs a schema-validated
structured outcome back. Single Go binary with the war-room web app embedded,
zero external dependencies, dry-run by default.

**Contribution area: Runnable app (User-facing Apps).** This directory is a
catalog and setup guide for the runnable
[callhook application](https://github.com/iSundram/callhook), maintained
there under the MIT license.

- [Project description and full setup](https://github.com/iSundram/callhook#readme)
- [Documentation site](https://callhook.github.io)
- [Demo video (3 min)](https://youtu.be/66siB3kIYMk)
- [Live demo (dry-run, no calls placed)](https://callhook.onrender.com)
- [One-line installer](https://callhook.github.io/install.sh)

## What it does

Most phone-agent projects are one workflow. callhook is the layer underneath:

- **Event-driven calling** — `POST /api/events` with any of 8 event types
  (`invoice.due`, `appointment.reminder`, `delivery.window`,
  `payment.failed`, `account.warning`, `promo.offer`,
  `subscription.expiring`, `feedback.request`). Each is a blueprint: the
  call task is composed with live business data baked in, and the outcome
  comes back as a JSON-Schema-validated structured result.
- **Goal-driven campaigns** — declare a goal ("collect 5 payment promises
  from the overdue list") instead of a dial-list. Waves fire, no-answers
  requeue, budgets hard-stop, and the campaign stops the moment the goal is
  met (E2E-verified: goal met in 12 of 15 budgeted calls; 18 people never
  called).
- **19 native webhook integrations** — Stripe, Slack, Shopify, HubSpot,
  GitHub, AWS SNS and more, each with its signature scheme verified against
  the vendor's own documentation, plus an n8n community node and a Zapier
  CLI app.
- **MCP server** — `POST /mcp` exposes six tools (`fire_event`,
  `launch_campaign`, `get_campaign`, `list_sessions`, `list_event_types`,
  `run_demo`) so any MCP client can operate the voice channel.
- **Demo safeguards** — persisted idempotency, JSONL journals, configured
  calling hours (9:00–20:00 recipient-local, weekdays), refusal-aware retry
  rules, per-source rate limiting, and per-call audit records. These are
  implementation safeguards, not a crash-proof or universal exactly-once guarantee.

## Supported host and CALL-E integration

The server is a single Go binary (the React war-room app is embedded via
`go:embed`); there is no database and no external Go dependency. CALL-E
integration uses the Developer API directly, stdlib HTTP only:

1. An event arrives via `POST /api/events` (or a native platform webhook,
   signature-verified). Duplicate event ids are rejected — an event id is
   its idempotency key, persisted across restarts.
2. The customer record is prefetched from the business store and baked into
   the call task, so the voice agent never asks for account details.
3. A call is placed via `POST /v1/calls` with a `result_schema` and a
   per-attempt idempotency key intended to limit duplicate submission. A demo
   replay does not establish crash-proof delivery; ambiguous outcomes require
   operator reconciliation before another call.
4. The terminal webhook (`POST /callhook/webhook`, event-id deduped) drives
   the outcome engine: unambiguous results write to the business store
   (`mark_promise`), uncertain ones escalate to a human. Transcripts are
   re-fetched via `GET /v1/calls/{id}` because webhook payloads omit them —
   a behavior verified during live-fire testing against production CALL-E.
5. The structured outcome, actions taken, transcript, and confidence POST
   back to the originating system's `callback_url`.

## Setup

```bash
curl -fsSL https://callhook.github.io/install.sh | bash
./callhook/callhook_linux_amd64/callhook
# → war room at http://localhost:8080
```

Or from source: `git clone https://github.com/iSundram/callhook && cd
callhook/backend && go run ./cmd/callhook`. Full reference:
[callhook.github.io](https://callhook.github.io).

## Credential handling

The only credential is `CALLHOOK_API_KEY` (your CALL-E key), read from the
environment — never written to disk by callhook, never logged. Optional
`CALLHOOK_INTAKE_TOKEN` gates every `/api/*` endpoint (bearer) and
`CALLHOOK_WEBHOOK_SECRET` gates the CALL-E webhook. Per-platform webhook
secrets are separate env vars, one per integration.

## Dry-run behavior (the default)

Without `CALLHOOK_API_KEY`, callhook runs in **dry-run mode**: the entire
pipeline executes — events, campaigns, retries, outcome engine, war room —
but calls are fabricated locally with schema-valid varied results. Zero
balance is spent; the header shows a persistent DRY-RUN indicator. The
[public demo](https://callhook.onrender.com) runs in this mode.

## Side effects

A live configuration places real outbound phone calls through CALL-E and
POSTs structured outcomes to the `callback_url` each event carries. Business
writes happen only post-call, from the validated structured result, and are
policy-gated: uncertain outcomes escalate instead of writing. Polite-hours
gating defers calls outside 9:00–20:00 recipient-local, weekdays. Every
action is recorded in a per-session audit trail shown in the war room.

## Cancellation

- A single event stops at any terminal outcome; refusals are never redialed
  and unanswered numbers get at most 2 redials.
- A campaign stops three ways: the goal is met (early-stop), the call budget
  is exhausted (hard stop), or an operator presses **Stop** in the war room
  (`POST /api/campaigns/{id}/stop`) — remaining audience members are marked
  skipped and never called.
- The server shuts down gracefully on SIGINT/SIGTERM; in-flight campaigns
  resume from their journal on restart.
