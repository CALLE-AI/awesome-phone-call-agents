# CALL-E architecture — Call Aunty

## Flow

```
CHW woman record (prepare → review side effects → confirm)
  → authenticated tRPC `calle.prepare` / `calle.confirm` / `calle.status` / `calle.cancel`
  → call policy (consent, region, language, urgent triage, kill switch)
  → CALL-E adapter (dry-run by default; live `@call-e/calle` when enabled)
  → structured result validator
  → follow-up mapper
  → local follow-up store + sync queue (+ optional DB upsert)
  → CHW sees status + next action
```

## Server modules

| Module | Role |
|--------|------|
| `server/calle/types.ts` | Zod schemas, workflow statuses, structured result |
| `server/calle/policy.ts` | Allow / dry-run / deny rules |
| `server/calle/adapter.ts` | `DryRunCalleAdapter` + `LiveCalleAdapter` |
| `server/calle/map-to-follow-up.ts` | Map to existing follow-up enums |
| `server/calle/service.ts` | Prepare / confirm / status / cancel + idempotency |
| `server/routers.ts` `calle.*` | Authenticated API surface |

## Secrets

- `CALLE_API_KEY` — server only
- `CALLE_LIVE_CALLS=true` — required for live calls
- `CALLE_KILL_SWITCH=true` — disables outbound calling

Never ship these to Expo / Metro / client bundles.

## Capability honesty

UI stays Bangla-first. Spoken CALL-E language and recipient region are explicit fields. Bangladesh / Bangla are not claimed as supported call runtimes.

## Persistence

- In-memory workflow store for dry-run / local demos
- `call_workflows` Drizzle table for durable metadata when MySQL is configured
- Transcripts are not retained by default
