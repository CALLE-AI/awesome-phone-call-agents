# SupplyCall AI

SupplyCall AI is a procurement operations workbench. When a purchase order is
missing supplier confirmation, an operator can ask CALL-E to place one disclosed
outbound call to the supplier, capture a structured fulfillment result, and then
apply deterministic resolve / track / escalate rules. The voice agent never
writes purchase-order status.

**Contribution area: User-facing Apps.** This directory is a catalog and setup
guide for the runnable
[SupplyCall AI application](https://github.com/nexoraoneio/SUPPLYCALL_AI).
Application source, tests, and MIT license live there. The instructions below
target revision
[`399425553451`](https://github.com/nexoraoneio/SUPPLYCALL_AI/tree/399425553451b3539e7baf0b7708714c4a22d949).

Implementation and live-verification statements are author-reported for that
revision, not independently verified production guarantees. Review this entry
through the no-call checks below; no private deployment or live-call evidence is
required for this catalog contribution.

- [Application repository](https://github.com/nexoraoneio/SUPPLYCALL_AI)
- [CALL-E integration notes](https://github.com/nexoraoneio/SUPPLYCALL_AI/blob/399425553451b3539e7baf0b7708714c4a22d949/docs/CALLE-INTEGRATION.md)
- [Architecture](https://github.com/nexoraoneio/SUPPLYCALL_AI/blob/399425553451b3539e7baf0b7708714c4a22d949/ARCHITECTURE.md)

## Supported host and CALL-E integration

The app runs locally as a TypeScript monorepo: NestJS API (`apps/api`), Next.js
dashboard (`apps/web`), shared types (`packages/shared`), PostgreSQL, and Redis /
BullMQ.

CALL-E integration uses the official TypeScript SDK `@call-e/calle`:

1. An OPEN exception appears on the dashboard (seeded demo PO).
2. The operator clicks **Resolve with CALL-E** (or **Retry CALL-E** after a
   FAILED attempt).
3. The API calls `createCall` with a task brief, one authorized E.164 recipient,
   an application-owned `resultSchema`, and a stable idempotency key.
4. Outbound calling uses CALL-E’s shared number pool (no purchased caller ID).
5. Terminal results arrive through an optional HTTPS webhook, or through a
   BullMQ poll fallback when `CALLE_WEBHOOK_URL` is empty.
6. `CallResultProcessorService` is the only terminal business path.
   `ExceptionDecisionService` maps the structured result to resolve, keep
   tracked, or escalate. UNKNOWN, null results, low confidence, or missing PO
   confirmation escalate for human review.

Relevant upstream source:

| Path | Responsibility |
| --- | --- |
| [`apps/api/src/calle/`](https://github.com/nexoraoneio/SUPPLYCALL_AI/tree/399425553451b3539e7baf0b7708714c4a22d949/apps/api/src/calle) | `@call-e/calle` client wrapper and secret redaction |
| [`apps/api/src/exceptions/`](https://github.com/nexoraoneio/SUPPLYCALL_AI/tree/399425553451b3539e7baf0b7708714c4a22d949/apps/api/src/exceptions) | Resolve / retry, idempotency, session reuse |
| [`apps/api/src/calls/`](https://github.com/nexoraoneio/SUPPLYCALL_AI/tree/399425553451b3539e7baf0b7708714c4a22d949/apps/api/src/calls) | Webhook intake and BullMQ poll jobs |
| [`apps/api/src/decisions/`](https://github.com/nexoraoneio/SUPPLYCALL_AI/tree/399425553451b3539e7baf0b7708714c4a22d949/apps/api/src/decisions) | Deterministic exception decisions |

## Setup and no-call verification

You do not need the original hackathon database. Use Node.js 20+, pnpm, Docker,
and a machine that can open ports `3000` / `3001` (and host-mapped Postgres
`5434` / Redis `6381`).

```bash
git clone https://github.com/nexoraoneio/SUPPLYCALL_AI.git
cd SUPPLYCALL_AI
git checkout --detach 399425553451b3539e7baf0b7708714c4a22d949
pnpm install
docker compose up -d
cp .env.example .env
pnpm --filter @supplycall/shared build
pnpm --filter @supplycall/api prisma:generate
```

Installing dependencies needs internet access. After installation, these focused
checks use mocked `CallEService` collaborators and do **not** require
`CALLE_API_KEY`, a supplier phone number, or a live CALL-E account:

```bash
pnpm --filter @supplycall/api test
```

Expected: Vitest passes. Specs under `apps/api` mock `createCall`, Prisma, and
queue collaborators. They verify idempotency key shape, duplicate-click reuse,
decision fail-closed behavior, webhook / poll processing, and secret redaction.
They do not dial the public telephone network.

Do not click **Resolve with CALL-E** or **Retry CALL-E** in the UI during this
verification path. Those buttons place a real outbound call when credentials and
`DEMO_SUPPLIER_PHONE` are configured.

## Run the application (local dashboard)

```bash
# In .env, leave CALLE_API_KEY empty for browse-only local use.
# Do not set a real phone number unless you intend an authorized live call.
pnpm --filter @supplycall/api prisma:migrate
pnpm --filter @supplycall/api prisma:seed
pnpm --filter @supplycall/api dev    # http://localhost:3001/api/health
pnpm --filter @supplycall/web dev    # http://localhost:3000
```

Seeded demo data uses fictional supplier contacts. Seed does not delete existing
call sessions or audit history.

## Opt-in live verification and credentials

1. Obtain your own CALL-E API access using the
   [official integration guide](https://github.com/CALLE-AI/call-e-integrations).
2. In your local, ignored `.env`, set `CALLE_API_KEY` (server-only; never
   `NEXT_PUBLIC_*`).
3. Set `DEMO_SUPPLIER_PHONE` to an E.164 number **you are authorized to call**,
   for example the fictional-format placeholder `+14155550100`. Set region and
   locale to values enabled on **your** CALL-E account (`DEMO_SUPPLIER_REGION`,
   `DEMO_SUPPLIER_LOCALE`).
4. Optionally set `CALLE_WEBHOOK_URL` to a public HTTPS tunnel ending at
   `/api/calls/webhook`. Leave it empty to use BullMQ polling.
5. Re-seed after changing the demo phone so the supplier record updates.
6. Open the dashboard, select an OPEN exception, and click **Resolve with CALL-E**
   only when you intend to place a live call. Answer as the fictional supplier
   contact. Inspect the structured result and resulting exception status.

Never commit `.env`, API keys, or a private phone number. This catalog entry uses
only fictional / reserved-style examples such as `+14155550100`.

## Side effects, cancellation, retry, and idempotency

- Clicking **Resolve with CALL-E** or **Retry CALL-E** sends a task to CALL-E and
  places a real outbound call when credentials are present.
- First-attempt CALL-E idempotency key:
  `exception:{id}:resolve-with-call:v1`.
- Failed attempts remain in the audit log. **Retry** creates a new `CallSession`
  and `…:v2` (or later). Duplicate clicks reuse an in-flight or existing session
  and do not place a second call.
- RESOLVED and ESCALATED exceptions cannot start another call.
- BullMQ poll job ids use `call-poll-{sessionId}` and must not contain `:`.
- If CALL-E reports `canceled` or `failed`, the exception becomes FAILED and an
  in-app escalation notification is stored. Stopping the local API does not
  cancel an already-submitted provider call; the recipient can end the call.
- There are no recurring schedules in this workflow.

## Structured result (application-owned schema)

Fields include `fulfillmentStatus`, `poConfirmed`, `availableQuantity`,
`expectedDate`, `reason`, `buyerActionNeeded`, and `evidence`.

## Example (fictional)

```ts
await client.calls.create(
  {
    task: 'Call the supplier about PO-10482 and collect fulfillment facts. Do not negotiate.',
    recipients: [{ phones: ['+14155550100'], region: 'US', locale: 'en-US' }],
    resultSchema: { /* supplier confirmation JSON Schema */ },
    metadata: {
      exceptionId: 'ex_demo',
      workflow_run_id: 'exception:ex_demo:resolve-with-call:v1',
    },
  },
  { idempotencyKey: 'exception:ex_demo:resolve-with-call:v1' },
);
```

## Limitations

Recipient country and language availability are determined by the CALL-E
account. Unsupported regions can fail at create time. This contribution is a
local operations prototype with application-owned audit state, not a multi-tenant
procurement SaaS.

## Links

- Application repository: https://github.com/nexoraoneio/SUPPLYCALL_AI
- CALL-E docs: https://docs.heycall-e.com/
- SDK: `@call-e/calle`
