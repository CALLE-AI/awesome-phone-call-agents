# Server reference

AfterHold API server lives in `apps/typescript/afterhold-api/`. Built on Fastify + better-sqlite3.

## Env

```
PORT=8787
HOST=0.0.0.0
APP_ORIGIN=http://localhost:8081
DATABASE_FILE=./data/afterhold.db

JWT_SECRET=…                  # 32+ random bytes
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=30d

CALLE_MOCK=1                  # 1 = scripted phase timeline, 0 = real CALL-E
CALLE_ENABLED=1               # kill switch — set 0 to freeze all starts
CALLE_API_KEY=                # required only when CALLE_MOCK=0
CALLE_BASE_URL=https://api.heycall-e.com

POLL_FIRST_DELAY_SEC=60       # first wait after start; 0 in mock
POLL_INTERVAL_SEC=8           # cadence after first poll; 1.5s in mock

RATE_LIMIT_PER_HOUR=5
QUIET_HOURS_START=21
QUIET_HOURS_END=7
```

## Endpoints

| Method | Path | Notes |
|---|---|---|
| `POST` | `/v1/auth/register` | `{email,password,name}` → tokens |
| `POST` | `/v1/auth/login` | `{email,password}` → tokens |
| `POST` | `/v1/auth/refresh` | `{refresh_token}` → new tokens |
| `POST` | `/v1/auth/logout` | `{refresh_token}` → revoke |
| `POST` | `/v1/auth/consent` | `{version,granted:true}` → ok |
| `GET`  | `/v1/me` | profile + consent flag |
| `PATCH`| `/v1/me` | partial profile update |
| `GET`  | `/v1/numbers` | allowlist |
| `POST` | `/v1/numbers` | add `{e164,label?}` |
| `DELETE` | `/v1/numbers/:id` | remove |
| `POST` | `/v1/missions` | create draft |
| `POST` | `/v1/missions/:id/preview` | generate task string |
| `POST` | `/v1/missions/:id/start` | gated start → real or mock dial |
| `GET`  | `/v1/missions/:id` | mission + brief |
| `GET`  | `/v1/missions/:id/events?since=N` | event log for stream |
| `POST` | `/v1/missions/:id/cancel` | best-effort cancel |
| `POST` | `/v1/missions/:id/retry` | clone mission from brief |
| `GET`  | `/v1/missions?filter=live\|scheduled\|done` | list |
| `GET`  | `/health` | unauthed liveness |

## Worker cadence

The worker:

1. On `POST /v1/missions/:id/start`, fires off `setImmediate(() => runMission(id))`.
2. `runMission` waits `POLL_FIRST_DELAY_SEC` (0 in mock, 60s in real), then polls
   `GET /v1/calls/{id}` every `POLL_INTERVAL_SEC` (1.5s in mock, 8s in real).
3. On each poll, appends one event per status change plus one per callee transcript line.
4. On terminal status, writes the brief and updates the mission status.

A 5-second sweeper also calls `tickAllLive()` to recover missions whose worker crashed.

## Safety gates (server-side only)

Every gate is enforced inside `services/safety.ts`. The iOS client cannot bypass them.

- **`CALLE_ENABLED=0`** → all `/start` calls return 503.
- **No consent snapshot** → 412.
- **Number not on allowlist** (skipped under mock) → 403.
- **Quiet hours + now-call** → 429.
- **Rate limit exceeded** → 429.

## Logging

Logs go through Fastify's pino logger. Do not log raw API keys or full transcripts to stdout in
production. Set `LOG_LEVEL=warn` for production deployments.
