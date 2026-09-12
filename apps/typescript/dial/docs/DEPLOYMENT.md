# Deployment

## Shape

Four deployables, three of which are long-lived processes:

```
apps/api      Node service, HTTP + SSE          scales horizontally, stateless
apps/worker   Node service, no inbound ports    scales horizontally
apps/web      Next.js server (SSR + BFF proxy)  scales horizontally
apps/mobile   store artefacts                   see MOBILE_RELEASE.md
```

Plus managed PostgreSQL.

**The worker must run on infrastructure that can execute long-lived background
jobs.** A serverless function cannot host it: a call can take minutes, and the
loop must survive between HTTP requests. If the platform only offers functions,
run the worker on a container/VM tier and keep the API and web on the serverless
tier — they are stateless and fine there.

## Prerequisites

- Node 20.11 or later (built and tested on 24.5).
- PostgreSQL 14+. `DATABASE_URL` is **required** in production; the config layer
  refuses to boot with PGlite when `NODE_ENV=production`.
- HTTPS in front of both the API and the web app.
- A publicly reachable HTTPS URL for `CALLE_WEBHOOK_URL` if webhooks are used.
  Without it the worker still reconciles by polling.

## Environment

Every variable is documented in `.env.example`. The ones that must be set in
production:

```
NODE_ENV=production
DATABASE_URL=postgres://...
SESSION_SECRET=<48 random bytes, base64url>
ENCRYPTION_KEY=<48 random bytes, base64url>
CORS_ORIGINS=https://app.example.com
SERVER_API_URL=https://api.example.com     # web -> api, server-side only
PUBLIC_WEB_URL=https://app.example.com
CALLE_API_KEY=<from dashboard.heycall-e.com>
LLM_API_KEY=<google gemini api key>
OSM_CONTACT_EMAIL=ops@example.com
TEST_PROVIDER=real                         # only when you intend real calls
```

Store them in the platform's secret manager. `CALLE_API_KEY` and `LLM_API_KEY`
go to the **api and worker services only** — the web service must never receive
them, and does not need them.

## Migrations

Forward-only, recorded in `_migrations`, idempotent, and safe to run repeatedly.

```bash
npm run db:migrate
```

Run it as a release step before the new API and worker start. The API also runs
pending migrations at boot as a safety net; the worker does not, so it never
races the API for the same lock.

There is no destructive reset path in the codebase.

## Build

```bash
npm ci
npm run build          # packages, then api, worker, web
```

Artefacts: `packages/*/dist`, `apps/api/dist`, `apps/worker/dist`,
`apps/web/.next`.

## Running

```bash
node apps/api/dist/index.js      # honours PORT / HOST
node apps/worker/dist/index.js
npm run start -w @dial/web
```

Both services handle `SIGINT`/`SIGTERM`: the API closes the HTTP server, the
worker stops claiming new jobs and lets in-flight ones finish. A job that dies
mid-flight is reclaimed after ten minutes by `reclaimStaleJobs` and retried —
safely, because dispatch is idempotency-keyed.

## Health checks

```
GET /health   ->  { ok, callMode, integrations: { calle, llm, discovery, queue, database }, queue: {...} }
```

Use it as the liveness and readiness probe for the API. It reports what is
actually configured, so a deploy missing a key is visible immediately rather
than at the first user request.

The worker exposes no port. Monitor it through the `queue` block on `/health`:
a `pending` count that climbs while `running` stays at zero means no worker is
consuming.

## Monitoring

`packages/observability` emits structured JSON lines to stdout — collect them
with whatever the platform provides. Secrets, transcripts and raw phone numbers
are redacted before they are written.

`GET /metrics` (authenticated) returns counters and latency percentiles: task
duration, search latency, candidates discovered, calls requested/completed/
failed, webhook accepted/duplicate/rejected, queue depth.

Alert on:

- `queue.dead` — jobs exhausting their retries.
- `calls.dispatch_failed{code=insufficient_balance}` — calling credit gone.
- `webhook.rejected` climbing — someone probing the endpoint, or a contract change.
- `search.provider_error` — the directory is down; discovery is degraded.

## Scaling notes

- The API is stateless. Rate limiting is per-process and in-memory, so behind
  several instances it should move to a shared store.
- Multiple workers are safe by design (`FOR UPDATE SKIP LOCKED` plus the unique
  idempotency key), but see `docs/TESTING.md` — real multi-worker contention is
  untested and should be verified against a real Postgres before scaling out.
- Set `MAX_CALL_CONCURRENCY` to bound how many calls one worker dispatches at
  once; it is also the queue batch size.

## Rollback

Deploy the previous build. Migrations are additive, so an older binary runs
against a newer schema. In-flight calls are unaffected: their results are
reconciled from CALL-E on the next poll, whichever worker version picks them up.
