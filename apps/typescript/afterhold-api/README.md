# afterhold-api

AfterHold API — the workspace, auth, mission state machine, schema, safety gates, and
worker that sits in front of the CALL-E call runtime. This is the runnable server that the
iOS client (`AfterHold`) talks to.

The iOS client never holds `CALLE_API_KEY`. The server holds it. The iOS client only has a
JWT for the user.

**Scope:** a hackathon / community demo. It is safe by default (mock mode, loopback only) and
supports an opt-in live mode for operators who control the recipients. It is not a production
calling platform.

## Quick start (mock mode — no call is placed)

Run from this directory (`apps/typescript/afterhold-api`):

```bash
cp .env.example .env       # CALLE_MOCK=1 by default; no secrets needed for a local mock run
npm install
npm run dev                # http://127.0.0.1:8787
```

In a second terminal, from the **repository root**, run the dry-run script:

```bash
node skills/afterhold-ivr-errand/scripts/dry-run.mjs
```

The script talks only to a loopback server and exits without sending anything unless `/health`
reports `mock: true`. You should see the mission walk
`draft → previewed → queued → planning → dialing → in_conversation → wrapping → completed`
with a courier brief in ~20 seconds. All sample numbers are fictional `555-01xx` numbers.

## Live mode (opt-in)

Real calls only happen when **all** of these hold:

1. `CALLE_MOCK=0` and a real `CALLE_API_KEY`.
2. A real `JWT_SECRET` (`openssl rand -hex 32`). The server will not start in live mode, or on a
   non-loopback `HOST`, with an empty or public-example secret.
3. `CALLE_BASE_URL` is `https://api.heycall-e.com` or `https://test-api.heycall-e.com`. Any other
   origin stops the server at boot, so the API key cannot be sent elsewhere.
4. The destination is on the user's allowlist (`POST /v1/numbers`), and you have confirmed that the
   person or business you are calling has authorized the call.
5. The mission has a `region` (e.g. `US`) and each run sends `{"confirm_live": true}` to `/start`.

Cancelling a mission is local: it stops AfterHold from tracking the call and prevents a call that
has not been sent yet. **It does not recall a call CALL-E has already accepted.**

## Architecture

```
iOS (expo-secure-store JWT) ── HTTPS ──► AfterHold API (Fastify) ── HTTPS ──► CALL-E API
                                       │
                                       ├── better-sqlite3 (or Postgres in prod)
                                       ├── background worker (polls CALLE)
                                       └── safety gates (consent, allowlist, quiet hours, rate limit)
```

Single-process. SQLite by default; `docker-compose.yml` shows a Postgres-shaped deployment.

## Endpoints

See [`skills/afterhold-ivr-errand/references/server.md`](../../../skills/afterhold-ivr-errand/references/server.md)
for the full list.

## Env

See `.env.example`. The interesting knobs:

- `CALLE_MOCK=1` (default) — scripted phase timeline; no call is placed.
- `CALLE_ENABLED=0` — kill switch; rejects all `/start` calls and scheduled dials.
- `CALLE_API_KEY` — required when `CALLE_MOCK=0`.
- `JWT_SECRET` — 32+ random bytes. Optional only for a local mock run on loopback.
- `HOST` — `127.0.0.1` by default.
- `RATE_LIMIT_PER_HOUR=5` — keeps a single user from burning the 20-call free tier in 4 hours.

## Behaviour worth knowing

- **Schedules.** `schedule_at` must be in the future. The mission is stored as `scheduled` and the
  server dials it when due, re-running every gate at that moment. It is never dialed early.
- **Unknown creation.** If creating the CALL-E call times out or returns 5xx, the call may exist.
  The mission becomes `submission_unknown` and is never retried automatically; `/retry` returns
  `409` until you check the CALL-E dashboard.
- **Masking.** Phone-like numbers are masked in all responses (missions, task strings, events,
  briefs, errors) and in logged worker errors.

## Scripts

- `npm run dev` — tsx watcher
- `npm run build` — emit `dist/`
- `npm start` — run `dist/server.js`
- `npm run lint` — typecheck

## Deployment notes

1. Provision Postgres or keep SQLite for a low-traffic demo.
2. Set a real `JWT_SECRET`, and `CALLE_API_KEY` only if you intend to place live calls.
3. Run behind a TLS reverse proxy and set `HOST=0.0.0.0` only there.

## License

MIT.
