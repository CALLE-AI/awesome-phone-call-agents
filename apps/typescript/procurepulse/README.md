# ProcurePulse

An urgent supplier quote race over CALL-E.

A restaurant runs out of basil at 4 PM; service starts at 7. Its approved suppliers do not
publish live stock - they answer the phone. ProcurePulse calls each authorized supplier through
CALL-E with the identical outcome-focused questions, validates every per-supplier structured
result against a strict schema, and ranks only quotes that can honestly be compared. A vague
answer becomes **needs review** with the specific reasons, never a guessed number. Approving a
supplier is an internal record; asking that supplier to hold stock takes a second explicit
approval and a second call that says out loud it is not a purchase.

This directory is the portable CALL-E core of the full ProcurePulse buyer desk (a web app with
a live race board, evidence dialog, and approval flow), packaged as a dependency-free TypeScript
library and CLI.

## What it demonstrates

| Pattern | Where |
| --- | --- |
| One `recipient_result_schema` for every supplier: closed, every field a described string, business decisions as enums with `unknown`, no reserved field names | `src/schema.ts` |
| Number-like answers kept as strings until a deterministic step decides whether they justify arithmetic | `src/ranking.ts` |
| A comparable total only when quantity, unit, availability, currency, price and fees are all unambiguous; hedges matched as whole words; completeness kept separate from CALL-E certainty | `src/ranking.ts` |
| A task that discloses the agent is AI and the business it represents in the first sentence, forbids orders, holds, terms and payment details, and never contains the phone number | `src/task.ts` |
| A stable `Idempotency-Key` per request, supplier and purpose, so a double click or retry never places a second call | `src/task.ts`, `src/race.ts` |
| The live lifecycle from the snapshot itself: task status refined by the latest attempt into queued, ringing, on the call, finalizing, completed | `src/calle.ts` |
| Read-only polling as the default result path, so a timeout can never redial | `src/race.ts` |
| An unsigned-webhook receiver: path token, `CALL-E-Event-Id` matched to the body `id`, the call taken from `data.id`, the event claimed before side effects, and an independent `GET /v1/calls/{id}` | `src/webhook.ts` |
| Two human gates: internal approval of a validated quote, then a separately confirmed hold call with its own result schema | `src/race.ts` |
| The bearer token pinned to `https://api.heycall-e.com` (or a loopback fake server) | `src/calle.ts` |
| A loopback fake CALL-E that rejects unknown fields, reserved schema fields and non-E.164 phones in the live API's order | `src/fake-calle.ts` |

## Setup

Node.js 20 or newer. No runtime dependencies; `tsx` and `typescript` are dev dependencies.

```bash
cd apps/typescript/procurepulse
npm install
```

## Preview - the default path

Preview prints the preflight the buyer confirms (who is represented, the masked recipients,
the boundary) and the exact `POST /v1/calls` body with its idempotency key. It calls nobody
and needs no API key:

```bash
npm run preview
npx tsx src/cli.ts preview --request examples/request.json
```

## Demo - the whole race against a fake CALL-E

`demo` starts a loopback fake CALL-E server, runs the race with the fictional suppliers in
`examples/`, polls the calls through queued, ringing and on the call to completed, prints the
ranked board, then records a demo-only internal approval and a hold call:

```bash
npm run demo
```

```text
Riverside Produce      $290.00        exact · pickup · ready 2026-09-11T18:15:00-07:00 · 100% complete  [LOWEST COMPLETE TOTAL]
Northstar Foods        $310.00        substitute · delivery · ready 2026-09-11T17:00:00-07:00 · 100% complete  [EARLIEST READY]
Golden Gate Supply     Needs review   unknown · unknown · ready not supplied · 54% complete
                       ! Ambiguous or incompatible quantity unit.
                       ! Available quantity does not cover the request.
                       ! Price, fees, or currency need review.
                       ! Price or fulfillment is conditional.
                       ! CALL-E reported low answer certainty.
...
Hold call: completed · hold confirmed until 2026-09-11T20:00:00-07:00 by Sam · not a purchase
4 create-call requests reached the fake server; 0 real calls.
```

## Replay - rank a saved call offline

```bash
npx tsx src/cli.ts replay examples/fictional_completed_call.json
```

## Tests

```bash
npm test          # 27 offline tests; no key, no network beyond 127.0.0.1
npm run typecheck
```

## Live use - real phone calls

Live commands place real calls to real businesses. Only call suppliers you already have a
relationship with, who have agreed to be called.

1. Copy `.env.example` to `.env` (git-ignored) and set `CALLE_API_KEY` and
   `PROCUREPULSE_DIAL_ALLOWLIST` (comma-separated E.164 numbers; empty means nothing can be dialed).
2. Check the key without side effects: `npx tsx src/cli.ts check` (uses `GET /v1/goals`).
3. Put your suppliers in a request file (see `examples/request.json`) and preview it.
4. Start the race and poll until every call is terminal:

   ```bash
   npx tsx src/cli.ts start --request my-request.json --execute --i-have-consent --wait
   ```

5. Record the internal decision (no call, no order): `npx tsx src/cli.ts approve <vendor-id> --i-approve`
6. Optionally ask that supplier for a non-purchase hold:

   ```bash
   npx tsx src/cli.ts hold --execute --i-have-consent --i-approve-hold --wait
   ```

State lives in `.procurepulse/ledger.json` (git-ignored, written atomically). `sync` polls open
calls again and `board` prints the current board.

Webhooks are optional. To receive CALL-E terminal webhooks as well, run
`npx tsx src/cli.ts serve-webhook --port 8788`, expose it over HTTPS, and set `PUBLIC_BASE_URL`
and a random `PROCUREPULSE_WEBHOOK_TOKEN` (16+ characters); new calls then include
`webhook_url`. Polling keeps working either way, because CALL-E only sends terminal events.

## Side effects and safety

- **Explicit intent.** Nothing dials without `--execute --i-have-consent`, and every number must
  also be in `PROCUREPULSE_DIAL_ALLOWLIST`. Preview, demo, replay and tests never dial.
- **E.164 only.** Numbers are validated before anything is sent; CALL-E rejects others too.
- **Masking.** Previews, boards and errors show `+1••••••••42`, never a full number. The phone
  number is never part of the spoken task.
- **Credentials.** `CALLE_API_KEY` is read from the environment or `.env`, never printed or
  written to the ledger, and only sent to `https://api.heycall-e.com` (or a loopback fake).
- **No duplicate calls.** One task per supplier and purpose with a stable `Idempotency-Key`;
  re-running `start` skips suppliers that already have a call id.
- **No hidden or recurring jobs.** Each command runs once in the foreground. There is no
  scheduler and no provider-side recurrence.
- **Cancellation.** Without `--execute` nothing is created. Stopping `--wait` (Ctrl+C) only stops
  polling; calls already accepted by CALL-E continue, and CALL-E 0.7.0 exposes no cancel
  endpoint, so run `sync` later to record their outcome. Deleting the ledger abandons the race
  locally; a new race needs a new request id.
- **Financial boundary.** The agent never places orders, accepts terms, asks for or gives
  payment details, or treats a hold as a purchase. Approval is an internal record only. The app
  is not for medical, legal or emergency calls.

## CALL-E contract notes (OpenAPI 0.7.0)

- Create: `recipients: [{ phones: [E164], locale: "en-US", region: "US" }]`; `region` is a
  country code. CALL-E validates, in this order and before dialing: request shape (`422` for
  unknown fields), `recipient_result_schema` (`400` for unsupported keywords or reserved field
  names), then phone numbers (`400 invalid_phone`). This payload shape was checked against the
  live API that way, with an invalid number so nothing was dialed.
- Results: the per-supplier result is `recipients[0].structured_result`; `null` means CALL-E
  could not produce a schema-valid result, which this app records as `result_validation_failed`.
- Webhooks: the event id is the top-level `id` and must equal the `CALL-E-Event-Id` header; the
  call is `data`, so the call id is `data.id`.
- `failure_code` has no published enum; it is stored verbatim for support and never branched on.

## Files

| Path | Purpose |
| --- | --- |
| `src/schema.ts` | Quote and hold result schemas and strict validators |
| `src/ranking.ts` | Completeness, unit-aware analysis, deterministic ranking |
| `src/phone.ts` | E.164 validation, masking, dial allowlist, country code |
| `src/task.ts` | Quote and hold call bodies, idempotency keys |
| `src/calle.ts` | CALL-E REST client and snapshot readers |
| `src/ledger.ts` | Atomic JSON ledger: tasks, claimed events, decision, audit |
| `src/race.ts` | Preflight, dispatch, polling sync, board, approval, hold |
| `src/webhook.ts` | Unsigned terminal-webhook receiver |
| `src/fake-calle.ts` | Loopback fake CALL-E for the demo and tests |
| `src/cli.ts` | Preview-first command line |
| `examples/` | Fictional request, supplier outcomes, and a completed call snapshot |
| `test/` | Offline tests |
