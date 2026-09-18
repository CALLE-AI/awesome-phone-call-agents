# afterhold-api

AfterHold API — the workspace, auth, mission state machine, schema, safety gates, and
worker that sits in front of the CALL-E call runtime. This is the runnable server that the
iOS client (`AfterHold`) talks to.

The iOS client never holds `CALLE_API_KEY`. The server holds it. The iOS client only has a
JWT for the user.

## Quick start

```bash
cp .env.example .env       # CALLE_MOCK=0 by default — real CALL-E calls
# Edit .env and set CALLE_API_KEY=… first.
npm install
npm run dev                # http://localhost:8787

# In another terminal — full dry-run that walks the phase timeline in mock mode:
node ../../skills/afterhold-ivr-errand/scripts/dry-run.mjs
```

To run in **mock mode** (no live calls, scripted phase timeline), set
`CALLE_MOCK=1` in `.env`. Useful for the demo video recording or offline dev.

You should see the mission walk: `draft → previewed → queued → planning → dialing →
in_conversation → wrapping → completed` with a believable courier brief in ~20 seconds.

## Architecture

```
iOS (expo-secure-store JWT) ── HTTPS ──► AfterHold API (Fastify) ── HTTPS ──► CALL-E API
                                       │
                                       ├── better-sqlite3 (or Postgres in prod)
                                       ├── background worker (polls CALLE)
                                       └── safety gates (consent, allowlist, quiet hours, rate limit)
```

Single-process for v1. Postgres recommended for production (see `docker-compose.yml`).

## Endpoints

See `../../skills/afterhold-ivr-errand/references/server.md` for the full list.

## Env

See `.env.example`. The interesting knobs:

- `CALLE_MOCK=1` — run a scripted phase timeline without burning real CALL-E calls.
- `CALLE_ENABLED=0` — kill switch; rejects all `/start` calls.
- `CALLE_API_KEY` — required when `CALLE_MOCK=0`.
- `JWT_SECRET` — 32+ random bytes. Rotate carefully (invalidates all sessions).
- `RATE_LIMIT_PER_HOUR=5` — keeps a single user from burning the 20-call free tier in 4 hours.

## Scripts

- `npm run dev` — tsx watcher
- `npm run build` — emit `dist/`
- `npm start` — run `dist/server.js`
- `npm run lint` — typecheck

## Deployment

1. Provision Postgres (or keep SQLite for low-traffic demo).
2. Set `CALLE_MOCK=0` and `CALLE_API_KEY=<real key>`.
3. Set `JWT_SECRET` to 32+ random bytes.
4. Run behind a TLS reverse proxy with the iOS client's `EXPO_PUBLIC_API_BASE_URL` pointing at
   the public URL.

## License

MIT.
