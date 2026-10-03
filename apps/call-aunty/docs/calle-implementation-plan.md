# CALL-E implementation plan — Call Aunty

## Reconnaissance

| Area | Path | Notes |
|------|------|-------|
| CHW woman record | `app/chw/[id].tsx` | Primary CALL-E prepare → confirm seam |
| CHW follow-up | `app/chw/follow-up.tsx` | Existing follow-up capture preserved |
| Triage | `lib/triage.ts` | `routine` \| `contact_chw_today` \| `urgent_in_person_care` |
| Follow-up | `lib/follow-up.ts` | Existing enums reused by mapper |
| Sync | `lib/sync-queue.ts`, `server/routers.ts` `sync.*` | Offline queue; no auto-dial |
| Auth / env | `server/_core/trpc.ts`, `server/_core/env.ts` | Secrets stay server-side |
| DB | `drizzle/schema.ts` | `users`, `follow_up_records`, `call_workflows` |

## Design decisions

1. Feature seam: `server/calle/*` only. UI talks to `trpc.calle.*`.
2. Default mode: dry-run unless `CALLE_LIVE_CALLS=true` and `CALLE_API_KEY` are set.
3. Capability honesty: Bangla UI ≠ spoken call language/region.
4. Consent required for live eligibility; demo prepare records consent explicitly.
5. Urgent triage denies conversational delay; human escalation stays primary.
6. Idempotent prepare via action token; confirm requires prepare token.
7. Structured CALL-E results map into existing follow-up enums without rewriting sync.

## Phase status

- Gate A: domain + policy + adapter + lifecycle tests — **done** (`tests/calle-workflow.test.ts` 10/10)
- Gate B: tRPC + CHW prepare/confirm UI + mapping — **done**
- Gate C: cancel/status + docs + contribution README — **done**
- Gate D: demo script, runbook, submission checklist — **done**
