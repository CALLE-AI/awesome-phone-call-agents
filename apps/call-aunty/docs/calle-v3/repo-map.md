# CALL-E V3 Repo Map

## Server entrypoints

| Path | Role |
|------|------|
| `server/_core/index.ts` | HTTP server bootstrap |
| `server/routers.ts` | tRPC app router (`auth`, `voice`, `calle`, `sync`) |
| `server/calle/*` | CALL-E adapter, policy, service, V2 capabilities |
| `server/db.ts` | Drizzle helpers (users, follow-ups) |
| `server/_core/env.ts` | Server env (includes `CALLE_*`) |

## Database

| Table | Status |
|-------|--------|
| `users` | Used |
| `follow_up_records` | Used via `upsertFollowUpRecord` |
| `call_workflows` | Schema present; persistence deferred / memory-first |

## Mobile screens

| Path | Role |
|------|------|
| `app/chw/[id].tsx` | Primary CALL-E prepare/confirm UI |
| `app/chw/follow-up.tsx` | Follow-up logging |
| `app/(tabs)/queue.tsx` | Sync/care queue |
| `app/(tabs)/care.tsx` | Care home |
| `app/(tabs)/settings.tsx` | Settings / language |

## API procedures (calle)

- `prepare`, `confirm`, `status`, `cancel` (V1)
- `capabilities`, `preflight` (V2)
- V3 adds demo/scenario/orchestrator diagnostics

## Tests

```bash
pnpm test
pnpm exec vitest run tests/calle-workflow.test.ts tests/calle-v2.test.ts
pnpm check
```

## Environment

| Var | Purpose |
|-----|---------|
| `CALLE_API_KEY` | Server-only provider key |
| `CALLE_LIVE_CALLS` | Opt-in live calls (`true`) |
| `CALLE_KILL_SWITCH` | Hard disable |
| `CALLE_DEMO_MODE` | Force demo/fake runtime (V3) |
| `DATABASE_URL` | Optional MySQL |

## Deployment assumptions

- Expo client talks to tRPC over the app API; never receives CALL-E secrets.
- Offline-first follow-up store + sync queue remain source of truth when DB is down.
