# VoltX VoiceOps

VoltX VoiceOps is a local operator desk for battery feedstock outreach. An
operator starts from a lead list, runs a labeled **SIMULATION** or one confirmed
live CALL-E call, and gets structured feedstock facts, an operational priority
score, and a follow-up queue.

**Contribution area: User-facing Apps.** This directory is a catalog and setup
guide for the runnable
[VoltX VoiceOps application](https://github.com/saksham23467/voltx-voiceops).
Application source, tests, and demo assets live there. The instructions below
target revision
[`fa3f630`](https://github.com/saksham23467/voltx-voiceops/tree/fa3f6305b0ae8f4038347189ac2b4aa8c2da7cda).

Implementation and live-verification statements are author-reported for that
revision, not independently verified production guarantees. Review this entry
through the no-call checks below; no private deployment or live-call evidence is
required for this catalog contribution.

- [Application repository](https://github.com/saksham23467/voltx-voiceops)
- [Demo script](https://github.com/saksham23467/voltx-voiceops/blob/fa3f6305b0ae8f4038347189ac2b4aa8c2da7cda/DEMO_SCRIPT.md)
- [README](https://github.com/saksham23467/voltx-voiceops/blob/fa3f6305b0ae8f4038347189ac2b4aa8c2da7cda/README.md)

## Supported host and CALL-E integration

The app runs locally as Next.js 16, TypeScript, React, SQLite, and Vitest.

Product live calls use the official TypeScript SDK `@call-e/calle` only
(`CalleClient.calls.create` / `calls.get`). MCP `plan_call` / `run_call` and
`calle call start` are not used for product outreach.

1. Import or seed a lead list (synthetic Delhi NCR sample, or CSV).
2. Create a campaign with a written objective. The agent identifies as an AI
   assistant.
3. Click **Run SIMULATION** (default) or **Launch 1 live CALL-E call**.
4. Live create payload is `task`, `recipient`, `metadata`, optional
   `webhookUrl`, and a stable idempotency key. `resultSchema` /
   `recipientResultSchema` are omitted because the live API rejected those
   fields. Extraction rules live in the task text.
5. VoltX scores locally after the snapshot. Webhook bodies are not applied as
   qualification; live jobs refresh via `calls.get`.

Relevant upstream source:

| Path | Responsibility |
| --- | --- |
| [`src/lib/calle/client.ts`](https://github.com/saksham23467/voltx-voiceops/blob/fa3f6305b0ae8f4038347189ac2b4aa8c2da7cda/src/lib/calle/client.ts) | `calls.create` / `calls.get` |
| [`src/lib/calle/service.ts`](https://github.com/saksham23467/voltx-voiceops/blob/fa3f6305b0ae8f4038347189ac2b4aa8c2da7cda/src/lib/calle/service.ts) | Live job start after dispatch gates |
| [`src/lib/calle/demo-preview.ts`](https://github.com/saksham23467/voltx-voiceops/blob/fa3f6305b0ae8f4038347189ac2b4aa8c2da7cda/src/lib/calle/demo-preview.ts) | Labeled SIMULATION fixtures |
| [`src/lib/task.ts`](https://github.com/saksham23467/voltx-voiceops/blob/fa3f6305b0ae8f4038347189ac2b4aa8c2da7cda/src/lib/task.ts) | CALL-E task copy and extraction rules |

## Setup and no-call verification

Requires Node.js 20.9+. Do not set `VOLTX_LIVE_CALLS=true` for this path.

```bash
git clone https://github.com/saksham23467/voltx-voiceops.git
cd voltx-voiceops
git checkout --detach fa3f6305b0ae8f4038347189ac2b4aa8c2da7cda
cp .env.example .env.local
npm install
npm test
npm run verify:env
```

Expected: Vitest passes. `npm run verify:env` prints live gates and
`CalleClient.calls.create` allowed: **false**. Tests inject fakes and never
construct a live `CalleClient`. Simulation fixtures use `demo:` ids and a
**SIMULATION** badge.

Placeholder sample numbers use a fictional `+9111555…` prefix and are refused
for live dialing.

## Run the application (local desk)

```bash
npm run dev
```

Open http://localhost:3000 then:

1. Click **Start 3-minute demo**.
2. Open **Delhi NCR Battery Supplier Outreach**.
3. Click **Run SIMULATION**. This does not consume CALL-E calls.
4. Open the completed **Okhla EV Fleet Services** call.
5. Open **Analytics** for the follow-up queue.

For a clean workspace, stop the app, delete `data/voltx.sqlite`, and start
`npm run dev` again.

## Opt-in live verification and credentials

1. Obtain your own CALL-E API access using the
   [official integration guide](https://github.com/CALLE-AI/call-e-integrations).
2. In ignored `.env.local`, set `CALLE_API_KEY` (server-only).
3. Set `VOLTX_LIVE_CALLS=true`. In `next dev` also set
   `VOLTX_ALLOW_LIVE_IN_DEV=true`.
4. Set `VOLTX_DEMO_LIVE_PHONE` to an E.164 number **you are authorized to call**.
   Do not use the synthetic `+9111555…` sample numbers.
5. Type the exact phrase `PLACE_LIVE_CALL` and click **Launch 1 live CALL-E call**
   only when you intend to ring a real phone.

Never commit `.env.local`, API keys, or a private phone number. This desk has no
operator authentication. Do not expose a public URL with live env enabled.

## Side effects, cancellation, retry, and idempotency

- **Run SIMULATION** writes local fixtures only. It does not call CALL-E.
- **Launch 1 live CALL-E call** places a real outbound call and consumes a
  CALL-E call when live gates pass.
- Each live job stores a stable idempotency key. An existing CALL-E id is
  GET-only; VoltX does not create a second call for that job.
- Pause / cancel / kill stop the next create. Hangup is not in the SDK
  (`SDK_HAS_CALL_CANCEL = false`). An in-flight live call is not torn down by
  stopping the local app.
- There are no hidden recurring schedules. Default live concurrency is 1.

## Limitations

Empty live structured payloads stay empty. Scores are an operational ranking,
not a revenue forecast. India destinations can sit in `queued` before they ring.
CRM writeback, callback-window follow-up, and pickup scheduling are not in this
build.

## Links

- Application repository: https://github.com/saksham23467/voltx-voiceops
- CALL-E docs: https://docs.heycall-e.com/
- SDK: `@call-e/calle`
